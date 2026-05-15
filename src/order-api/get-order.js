const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const response = require("../shared/response");
const logger = require("../shared/logger");
const {
  createHttpContext,
  durationMs,
  buildResponseHeaders,
  extractTraceContext,
  recordException,
  recordHttpServerMetrics,
  runWithActiveSpan,
  triggerOpenTelemetryFlush,
} = require("../shared/observability");

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ORDERS_TABLE_NAME = process.env.ORDERS_TABLE_NAME;

exports.handler = async (event, context) => {
  const parentContext = extractTraceContext(event?.headers || {});

  return runWithActiveSpan(
    "GET /orders/{orderId}",
    {
      kind: "SERVER",
      parentContext,
      attributes: {
        "http.route": "GET /orders/{orderId}",
        "http.request.method": "GET",
      },
    },
    async () => {
      const startTime = Date.now();
      const requestObservabilityContext = createHttpContext(event, context, {
        service: "order-api",
        operation: "get-order",
      });
      const log = logger.createLogger(requestObservabilityContext);
      const responseHeaders = buildResponseHeaders(requestObservabilityContext);
      const orderId = event.pathParameters?.orderId;

      try {
        if (!orderId) {
          const missingOrderIdResponse = response.badRequest({ message: "orderId is required" }, responseHeaders);
          const latencyMs = durationMs(startTime);

          recordHttpServerMetrics(requestObservabilityContext, {
            statusCode: missingOrderIdResponse.statusCode,
            latencyMs,
          });

          log.warn("Get order request missing orderId", { latencyMs });
          return missingOrderIdResponse;
        }

        const result = await dynamoClient.send(
          new GetCommand({
            TableName: ORDERS_TABLE_NAME,
            Key: { orderId },
          })
        );

        if (!result.Item) {
          const latencyMs = durationMs(startTime);
          const notFoundResponse = response.notFound({ message: "Order not found" }, responseHeaders);

          recordHttpServerMetrics(requestObservabilityContext, {
            statusCode: notFoundResponse.statusCode,
            latencyMs,
          });

          log.warn("Order not found", { orderId, latencyMs });
          return notFoundResponse;
        }

        const latencyMs = durationMs(startTime);
        const successResponse = response.ok(result.Item, responseHeaders);

        recordHttpServerMetrics(requestObservabilityContext, {
          statusCode: successResponse.statusCode,
          latencyMs,
        });

        log.info("Order retrieved", {
          orderId,
          status: result.Item.status,
          latencyMs,
        });

        return successResponse;
      } catch (error) {
        const latencyMs = durationMs(startTime);
        const errorResponse = response.internalError({ message: "Internal server error" }, responseHeaders);

        recordException(error, {
          "app.operation": requestObservabilityContext.operation,
          "http.route": requestObservabilityContext.routeKey || requestObservabilityContext.path,
        });
        recordHttpServerMetrics(requestObservabilityContext, {
          statusCode: errorResponse.statusCode,
          latencyMs,
        });

        log.error("Get order failed", {
          orderId,
          errorName: error.name,
          errorMessage: error.message,
          latencyMs,
        });

        return errorResponse;
      } finally {
        triggerOpenTelemetryFlush({
          route: requestObservabilityContext.routeKey || requestObservabilityContext.path,
          httpMethod: requestObservabilityContext.httpMethod,
          requestId: requestObservabilityContext.requestId,
          correlationId: requestObservabilityContext.correlationId,
        });
      }
    }
  );
};
