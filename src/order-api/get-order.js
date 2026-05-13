const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const response = require("../shared/response");
const logger = require("../shared/logger");
const {
  buildResponseHeaders,
  createHttpContext,
  durationMs,
} = require("../shared/request-context");

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ORDERS_TABLE_NAME = process.env.ORDERS_TABLE_NAME;

exports.handler = async (event, context) => {
  const startTime = Date.now();
  const requestContext = createHttpContext(event, context, {
    service: "order-api",
    operation: "get-order",
  });
  const log = logger.createLogger(requestContext);
  const responseHeaders = buildResponseHeaders(requestContext);
  const orderId = event.pathParameters?.orderId;

  if (!orderId) {
    log.warn("Get order request missing orderId", {
      latencyMs: durationMs(startTime),
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
      return response.notFound({ message: "Order not found" }, responseHeaders);
    }

    const latencyMs = durationMs(startTime);

    log.info("Order retrieved", {
      orderId,
      status: result.Item.status,
      latencyMs,
    });

    return response.ok(result.Item, responseHeaders);
  } catch (error) {
    log.error("Get order failed", {
      orderId,
      errorName: error.name,
      errorMessage: error.message,
      latencyMs: durationMs(startTime),
    });

    return response.internalError({ message: "Internal server error" }, responseHeaders);
  }
};
