const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const response = require("../shared/response");
const logger = require("../shared/logger");
const {
  addSpanEvent,
  createHttpContext,
  durationMs,
  emitMetric,
  forceFlushOpenTelemetry,
  recordException,
  setSpanAttributes,
  waitForOpenTelemetry,
} = require("../shared/observability");

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ORDERS_TABLE_NAME = process.env.ORDERS_TABLE_NAME;

exports.handler = async (event, context) => {
  await waitForOpenTelemetry();

  const startTime = Date.now();
  const observabilityContext = createHttpContext(event, context, {
    service: "order-api",
    operation: "get-order",
  });
  const log = logger.createLogger(observabilityContext);
  const responseHeaders = {
    "x-correlation-id": observabilityContext.correlationId,
  };
  const orderId = event.pathParameters?.orderId;

  setSpanAttributes({
    "app.order_id": orderId,
  });

  if (!orderId) {
    emitMetric("GetOrderErrors", 1, {
      service: "order-api",
      operation: "get-order",
      attributes: {
        "error.type": "ValidationError",
      },
      properties: {
        reason: "missing-order-id",
      },
    });
    emitGetOrderLatencyMetric(startTime, {
      result: "VALIDATION_ERROR",
    });
    return response.badRequest({ message: "orderId is required" }, responseHeaders);
  }

  try {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: ORDERS_TABLE_NAME,
        Key: { orderId },
      })
    );

    if (!result.Item) {
      const latencyMs = durationMs(startTime);

      log.warn("Order not found", { orderId, latencyMs });
      emitMetric("OrdersNotFound", 1, {
        service: "order-api",
        operation: "get-order",
        attributes: {
          "app.order_lookup_result": "NOT_FOUND",
        },
        properties: {
          orderId,
        },
      });
      emitGetOrderLatencyMetric(startTime, {
        orderId,
        result: "NOT_FOUND",
      });
      addSpanEvent("order.lookup.not_found", {
        "app.order_id": orderId,
      });
      return response.notFound({ message: "Order not found" }, responseHeaders);
    }

    const latencyMs = durationMs(startTime);

    log.info("Order retrieved", {
      orderId,
      status: result.Item.status,
      latencyMs,
    });
    emitMetric("OrdersRead", 1, {
      service: "order-api",
      operation: "get-order",
      attributes: {
        "app.order_status": result.Item.status,
      },
      properties: {
        orderId,
        status: result.Item.status,
      },
    });
    emitGetOrderLatencyMetric(startTime, {
      orderId,
      result: "FOUND",
      status: result.Item.status,
    });
    addSpanEvent("order.retrieved", {
      "app.order_id": orderId,
      "app.order_status": result.Item.status,
    });

    return response.ok(result.Item, responseHeaders);
  } catch (error) {
    recordException(error, {
      "app.operation": "get-order",
    });

    log.error("Get order failed", {
      orderId,
      errorName: error.name,
      errorMessage: error.message,
      latencyMs: durationMs(startTime),
    });
    emitMetric("GetOrderErrors", 1, {
      service: "order-api",
      operation: "get-order",
      attributes: {
        "error.type": error.name,
      },
      properties: {
        orderId,
        errorName: error.name,
      },
    });
    emitGetOrderLatencyMetric(startTime, {
      orderId,
      result: "ERROR",
      errorName: error.name,
    });

    return response.internalError({ message: "Internal server error" }, responseHeaders);
  } finally {
    await forceFlushOpenTelemetry();
  }
};

function emitGetOrderLatencyMetric(startTime, { orderId, result, status, errorName } = {}) {
  emitMetric("GetOrderLatencyMs", durationMs(startTime), {
    service: "order-api",
    operation: "get-order",
    unit: "Milliseconds",
    attributes: {
      "app.order_lookup_result": result,
      "app.order_status": status,
      "error.type": errorName,
    },
    properties: {
      orderId,
      result,
      status,
      errorName,
    },
  });
}
