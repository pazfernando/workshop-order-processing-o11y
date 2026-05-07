const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { ConditionalCheckFailedException, DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const logger = require("../shared/logger");
const { createEventContext, durationMs, emitMetric } = require("../shared/observability");

const lambdaClient = new LambdaClient({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const ORDERS_TABLE_NAME = process.env.ORDERS_TABLE_NAME;
const PAYMENT_SIMULATOR_FUNCTION_NAME = process.env.PAYMENT_SIMULATOR_FUNCTION_NAME;

exports.handler = async (event, context) => {
  const startTime = Date.now();
  const detail = event.detail || {};
  const observabilityContext = createEventContext(event, context, {
    service: "order-processor",
    operation: "process-order-created",
  });
  const log = logger.createLogger(observabilityContext);
  const orderId = detail.orderId;

  log.info("Order processor received event", { records: event.detail ? 1 : 0 });

  if (!orderId) {
    log.warn("Event without orderId was ignored", { detail });
    emitMetric("OrderProcessorIgnoredEvents", 1, {
      service: "order-processor",
      operation: "process-order-created",
      properties: {
        reason: "missing-order-id",
      },
    });
    return;
  }

  try {
    const order = await moveOrderToProcessing(orderId);
    const paymentStartTime = Date.now();
    const paymentResult = await invokePaymentSimulator(order, observabilityContext);
    const paymentLatencyMs = durationMs(paymentStartTime);
    await finalizeOrder(orderId, paymentResult);

    log.info("Order processed successfully", {
      orderId,
      finalStatus: paymentResult.paymentStatus,
      paymentLatencyMs,
      processingLatencyMs: durationMs(startTime),
    });
    emitMetric("OrdersProcessed", 1, {
      service: "order-processor",
      operation: "process-order-created",
      properties: {
        orderId,
        paymentStatus: paymentResult.paymentStatus,
      },
    });
    emitMetric("PaymentInvocationLatencyMs", paymentLatencyMs, {
      service: "order-processor",
      operation: "process-order-created",
      unit: "Milliseconds",
      properties: {
        orderId,
      },
    });
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      const currentOrder = await getOrder(orderId);
      log.info("Duplicate or already processed event skipped", {
        orderId,
        currentStatus: currentOrder?.status,
      });
      emitMetric("OrderProcessorDuplicateEvents", 1, {
        service: "order-processor",
        operation: "process-order-created",
        properties: {
          orderId,
          currentStatus: currentOrder?.status,
        },
      });
      return;
    }

    log.error("Order processing failed", {
      orderId,
      errorName: error.name,
      errorMessage: error.message,
      processingLatencyMs: durationMs(startTime),
    });
    emitMetric("OrderProcessorErrors", 1, {
      service: "order-processor",
      operation: "process-order-created",
      properties: {
        orderId,
        errorName: error.name,
      },
    });

    await failOrder(orderId, error.message);
    throw error;
  }
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
