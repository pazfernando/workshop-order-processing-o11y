const crypto = require("node:crypto");
const { EventBridgeClient, PutEventsCommand } = require("@aws-sdk/client-eventbridge");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const response = require("../shared/response");
const logger = require("../shared/logger");
const { AppError, ValidationError } = require("../shared/errors");
const { validateOrderPayload, calculateTotalAmount } = require("../shared/validation");
const {
  createHttpContext,
  durationMs,
  buildResponseHeaders,
  addSpanEvent,
  extractTraceContext,
  forceFlushOpenTelemetry,
  injectTraceContext,
  recordException,
  recordHttpServerMetrics,
  runWithActiveSpan,
} = require("../shared/observability");

const eventBridgeClient = new EventBridgeClient({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const ORDERS_TABLE_NAME = process.env.ORDERS_TABLE_NAME;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";

exports.handler = async (event, context) => {
  const parentContext = extractTraceContext(event?.headers || {});

  return runWithActiveSpan(
    "POST /orders",
    {
      kind: "SERVER",
      parentContext,
      attributes: {
        "http.route": "POST /orders",
        "http.request.method": "POST",
      },
    },
    async () => {
      const startTime = Date.now();
      const requestObservabilityContext = createHttpContext(event, context, {
        service: "order-api",
        operation: "create-order",
      });
      const log = logger.createLogger(requestObservabilityContext);
      const responseHeaders = buildResponseHeaders(requestObservabilityContext);

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
          correlationId: requestObservabilityContext.correlationId,
          createdAt: now,
          updatedAt: now,
        };

        await dynamoClient.send(
          new PutCommand({
            TableName: ORDERS_TABLE_NAME,
            Item: order,
            ConditionExpression: "attribute_not_exists(orderId)",
          })
        );

        addSpanEvent("order.persisted", {
          orderId,
          customerId: payload.customerId,
        });

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
                  correlationId: requestObservabilityContext.correlationId,
                  requestId: requestObservabilityContext.requestId,
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

        const successResponse = response.created({ orderId, status: "PENDING" }, responseHeaders);
        const latencyMs = durationMs(startTime);

        recordHttpServerMetrics(requestObservabilityContext, {
          statusCode: successResponse.statusCode,
          latencyMs,
        });

        log.info("Order created", {
          orderId,
          customerId: payload.customerId,
          totalAmount,
          latencyMs,
        });

        return successResponse;
      } catch (error) {
        const errorResponse = handleError(
          error,
          log,
          requestObservabilityContext,
          startTime,
          responseHeaders
        );

        return errorResponse;
      } finally {
        await forceFlushOpenTelemetry();
      }
    }
  );
};

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

function handleError(error, log, requestObservabilityContext, startTime, responseHeaders) {
  const latencyMs = durationMs(startTime);

  log.error("Create order failed", {
    errorName: error.name,
    errorMessage: error.message,
    details: error.details,
    latencyMs,
  });

  recordException(error, {
    "app.operation": requestObservabilityContext.operation,
    "http.route": requestObservabilityContext.routeKey || requestObservabilityContext.path,
  });

  let errorResponse;

  if (error instanceof ValidationError) {
    errorResponse = response.badRequest({
      message: error.message,
      details: error.details,
    }, responseHeaders);
  } else if (error instanceof AppError) {
    errorResponse = response.internalError({
      message: error.message,
      details: error.details,
    }, responseHeaders);
  } else {
    errorResponse = response.internalError({
      message: "Internal server error",
    }, responseHeaders);
  }

  recordHttpServerMetrics(requestObservabilityContext, {
    statusCode: errorResponse.statusCode,
    latencyMs,
  });

  return errorResponse;
}
