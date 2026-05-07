const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const response = require("../shared/response");
const logger = require("../shared/logger");

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ORDERS_TABLE_NAME = process.env.ORDERS_TABLE_NAME;

exports.handler = async (event) => {
  const orderId = event.pathParameters?.orderId;

  if (!orderId) {
    return response.badRequest({ message: "orderId is required" });
  }

  try {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: ORDERS_TABLE_NAME,
        Key: { orderId },
      })
    );

    if (!result.Item) {
      return response.notFound({ message: "Order not found" });
    }

    return response.ok(result.Item);
  } catch (error) {
    logger.error("Get order failed", {
      orderId,
      errorName: error.name,
      errorMessage: error.message,
    });

    return response.internalError({ message: "Internal server error" });
  }
};

