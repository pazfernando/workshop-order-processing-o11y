const crypto = require("node:crypto");
const { EventBridgeClient, PutEventsCommand } = require("@aws-sdk/client-eventbridge");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const response = require("../shared/response");
const logger = require("../shared/logger");
const { AppError, ValidationError } = require("../shared/errors");
const { validateOrderPayload, calculateTotalAmount } = require("../shared/validation");
const {
  addSpanEvent,
  createHttpContext,
  durationMs,
  emitMetric,
  forceFlushOpenTelemetry,
  injectTraceContext,
  recordException,
  runWithActiveSpan,
  setSpanAttributes,
  waitForOpenTelemetry,
} = require("../shared/observability");

const eventBridgeClient = new EventBridgeClient({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const ORDERS_TABLE_NAME = process.env.ORDERS_TABLE_NAME;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";

exports.handler = async (event, context) => {
  await waitForOpenTelemetry();

  return runWithActiveSpan("create-order", { kind: "SERVER" }, async () => {
    const startTime = Date.now();
    const observabilityContext = createHttpContext(event, context, {
      service: "order-api",
      operation: "create-order",
    });
    const log = logger.createLogger(observabilityContext);
    const responseHeaders = buildResponseHeaders(observabilityContext);

    try {
      const payload = parseBody(event.body);
      validateOrderPayload(payload);

      const now = new Date().toISOString();
      const orderId = crypto.randomUUID();
      const totalAmount = calculateTotalAmount(payload.items);

      const order = {
        orderId,
        customerId: payload.customerId,
        items: payload.items,
        currency: payload.currency,
        totalAmount,
        status: "PENDING",
        paymentStatus: "PENDING",
        correlationId: observabilityContext.correlationId,
        createdAt: now,
        updatedAt: now,
      };

      setSpanAttributes({
        "app.order_id": orderId,
      });

      await dynamoClient.send(
        new PutCommand({
          TableName: ORDERS_TABLE_NAME,
          Item: order,
          ConditionExpression: "attribute_not_exists(orderId)",
        })
      );

      const publishResult = await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              EventBusName: EVENT_BUS_NAME,
              Source: "workshop.orders",
              DetailType: "OrderCreated",
              Detail: JSON.stringify({
                eventType: "OrderCreated",
                eventVersion: "1.0",
                orderId,
                correlationId: observabilityContext.correlationId,
                requestId: observabilityContext.requestId,
                customerId: payload.customerId,
                totalAmount,
                currency: payload.currency,
                createdAt: now,
                traceContext: injectTraceContext({}),
              }),
            },
          ],
        })
      );

      if (publishResult.FailedEntryCount > 0) {
        const failureReason = publishResult.Entries?.[0]?.ErrorMessage || "Unknown EventBridge error";

        await markOrderAsFailed(orderId, failureReason);

        throw new AppError("Order event publication failed", 500, { orderId, failureReason });
      }

      const latencyMs = durationMs(startTime);

      log.info("Order created", {
        orderId,
        customerId: payload.customerId,
        totalAmount,
        latencyMs,
      });
      emitMetric("OrdersCreated", 1, {
        service: "order-api",
        operation: "create-order",
        attributes: {
          "app.order_status": "PENDING",
        },
        properties: {
          orderId,
          correlationId: observabilityContext.correlationId,
        },
      });
      emitMetric("CreateOrderLatencyMs", latencyMs, {
        service: "order-api",
        operation: "create-order",
        unit: "Milliseconds",
        properties: {
          orderId,
        },
      });
      addSpanEvent("order.created", {
        "app.order_id": orderId,
        "app.order_status": "PENDING",
      });

      return response.created({ orderId, status: "PENDING" }, responseHeaders);
    } catch (error) {
      return handleError(error, log, startTime, responseHeaders);
    } finally {
      await forceFlushOpenTelemetry();
    }
  });
};

function buildResponseHeaders(observabilityContext) {
  return {
    "x-correlation-id": observabilityContext.correlationId,
    ...(observabilityContext.traceId ? { "x-trace-id": observabilityContext.traceId } : {}),
  };
}

function parseBody(body) {
  try {
    return JSON.parse(body || "{}");
  } catch (error) {
    throw new ValidationError("Request body must be valid JSON");
  }
}

async function markOrderAsFailed(orderId, failureReason) {
  await dynamoClient.send(
    new UpdateCommand({
      TableName: ORDERS_TABLE_NAME,
      Key: { orderId },
      UpdateExpression: "SET #status = :status, #paymentStatus = :paymentStatus, updatedAt = :updatedAt, failureReason = :failureReason",
      ExpressionAttributeNames: {
        "#status": "status",
        "#paymentStatus": "paymentStatus",
      },
      ExpressionAttributeValues: {
        ":status": "FAILED",
        ":paymentStatus": "FAILED",
        ":updatedAt": new Date().toISOString(),
        ":failureReason": failureReason,
      },
    })
  );
}

function handleError(error, log, startTime, responseHeaders) {
  const latencyMs = durationMs(startTime);

  recordException(error, {
    "app.operation": "create-order",
  });

  log.error("Create order failed", {
    errorName: error.name,
    errorMessage: error.message,
    details: error.details,
    latencyMs,
  });
  emitMetric("CreateOrderErrors", 1, {
    service: "order-api",
    operation: "create-order",
    attributes: {
      "error.type": error.name,
    },
    properties: {
      errorName: error.name,
    },
  });

  if (error instanceof ValidationError) {
    return response.badRequest({
      message: error.message,
      details: error.details,
    }, responseHeaders);
  }

  if (error instanceof AppError) {
    return response.internalError({
      message: error.message,
      details: error.details,
    }, responseHeaders);
  }

  return response.internalError({
    message: "Internal server error",
  }, responseHeaders);
}
