const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { ConditionalCheckFailedException, DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const logger = require("../shared/logger");
const {
  createEventContext,
  durationMs,
  addSpanEvent,
  extractTraceContext,
  flushOpenTelemetryWithDiagnostics,
  injectTraceContext,
  recordException,
  runWithActiveSpan,
} = require("../shared/observability");

const lambdaClient = new LambdaClient({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const ORDERS_TABLE_NAME = process.env.ORDERS_TABLE_NAME;
const PAYMENT_SIMULATOR_FUNCTION_NAME = process.env.PAYMENT_SIMULATOR_FUNCTION_NAME;

exports.handler = async (event, context) => {
  const detail = event.detail || {};
  const parentContext = extractTraceContext(detail.traceContext || {});

  return runWithActiveSpan(
    "OrderCreated",
    {
      kind: "CONSUMER",
      parentContext,
      attributes: {
        "messaging.operation": "process",
        "messaging.destination.name": "default",
        "messaging.message.id": event?.id,
      },
    },
    async () => {
      const startTime = Date.now();
      const requestObservabilityContext = createEventContext(event, context, {
        service: "order-processor",
        operation: "process-order-created",
      });
      const log = logger.createLogger(requestObservabilityContext);
      const orderId = detail.orderId;

      try {
        log.info("Order processor received event", { records: event.detail ? 1 : 0 });

        if (!orderId) {
          log.warn("Event without orderId was ignored", { detail });
          return;
        }

        const order = await moveOrderToProcessing(orderId);
        addSpanEvent("order.processing.started", { orderId });

        const paymentStartTime = Date.now();
        const paymentResult = await invokePaymentSimulator(order, requestObservabilityContext);
        const paymentLatencyMs = durationMs(paymentStartTime);
        await finalizeOrder(orderId, paymentResult);

        addSpanEvent("order.processing.completed", {
          orderId,
          paymentStatus: paymentResult.paymentStatus,
        });

        log.info("Order processed successfully", {
          orderId,
          finalStatus: paymentResult.paymentStatus,
          paymentLatencyMs,
          processingLatencyMs: durationMs(startTime),
        });
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          const currentOrder = await getOrder(orderId);
          log.info("Duplicate or already processed event skipped", {
            orderId,
            currentStatus: currentOrder?.status,
          });
          return;
        }

        recordException(error, {
          "app.operation": requestObservabilityContext.operation,
          "app.order_id": orderId,
        });

        log.error("Order processing failed", {
          orderId,
          errorName: error.name,
          errorMessage: error.message,
          processingLatencyMs: durationMs(startTime),
        });

        await failOrder(orderId, error.message);
        throw error;
      } finally {
        await flushOpenTelemetryWithDiagnostics({
          operation: requestObservabilityContext.operation,
          requestId: requestObservabilityContext.requestId,
          correlationId: requestObservabilityContext.correlationId,
          orderId,
        });
      }
    }
  );
};

async function moveOrderToProcessing(orderId) {
  const currentOrder = await getOrder(orderId);

  if (!currentOrder) {
    throw new Error(`Order ${orderId} not found`);
  }

  await dynamoClient.send(
    new UpdateCommand({
      TableName: ORDERS_TABLE_NAME,
      Key: { orderId },
      ConditionExpression: "#status = :pending",
      UpdateExpression:
        "SET #status = :processing, updatedAt = :updatedAt ADD processingAttempts :increment",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":pending": "PENDING",
        ":processing": "PROCESSING",
        ":updatedAt": new Date().toISOString(),
        ":increment": 1,
      },
    })
  );

  return currentOrder;
}

async function invokePaymentSimulator(order, observabilityContext) {
  const invokeResult = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: PAYMENT_SIMULATOR_FUNCTION_NAME,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(
        JSON.stringify({
          orderId: order.orderId,
          totalAmount: order.totalAmount,
          currency: order.currency,
          correlationId: observabilityContext.correlationId,
          requestId: observabilityContext.requestId,
          traceContext: injectTraceContext({}),
        })
      ),
    })
  );

  const payload = JSON.parse(Buffer.from(invokeResult.Payload || []).toString("utf-8") || "{}");

  if (invokeResult.FunctionError) {
    throw new Error(payload.errorMessage || "Payment simulator returned an error");
  }

  if (!payload.paymentStatus || !["APPROVED", "REJECTED"].includes(payload.paymentStatus)) {
    throw new Error("Invalid payment simulator response");
  }

  return payload;
}

async function finalizeOrder(orderId, paymentResult) {
  const now = new Date().toISOString();
  const status = paymentResult.paymentStatus;

  await dynamoClient.send(
    new UpdateCommand({
      TableName: ORDERS_TABLE_NAME,
      Key: { orderId },
      ConditionExpression: "#status = :processing",
      UpdateExpression:
        "SET #status = :status, paymentStatus = :paymentStatus, updatedAt = :updatedAt REMOVE failureReason",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":processing": "PROCESSING",
        ":status": status,
        ":paymentStatus": status,
        ":updatedAt": now,
      },
    })
  );
}

async function failOrder(orderId, failureReason) {
  if (!orderId) {
    return;
  }

  try {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: ORDERS_TABLE_NAME,
        Key: { orderId },
        UpdateExpression:
          "SET #status = :failed, paymentStatus = :failed, updatedAt = :updatedAt, failureReason = :failureReason",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":failed": "FAILED",
          ":updatedAt": new Date().toISOString(),
          ":failureReason": failureReason,
        },
      })
    );
  } catch (error) {
    logger.error("Failed to mark order as FAILED", {
      orderId,
      errorName: error.name,
      errorMessage: error.message,
    });
  }
}

async function getOrder(orderId) {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: ORDERS_TABLE_NAME,
      Key: { orderId },
    })
  );

  return result.Item;
}
