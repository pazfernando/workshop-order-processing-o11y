const crypto = require("node:crypto");
const { EventBridgeClient, PutEventsCommand } = require("@aws-sdk/client-eventbridge");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const response = require("../shared/response");
const logger = require("../shared/logger");
const { AppError, ValidationError } = require("../shared/errors");
const { validateOrderPayload, calculateTotalAmount } = require("../shared/validation");

const eventBridgeClient = new EventBridgeClient({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const ORDERS_TABLE_NAME = process.env.ORDERS_TABLE_NAME;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";

exports.handler = async (event) => {
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
              customerId: payload.customerId,
              totalAmount,
              currency: payload.currency,
              createdAt: now,
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

    logger.info("Order created", { orderId, customerId: payload.customerId, totalAmount });
    return response.created({ orderId, status: "PENDING" });
  } catch (error) {
    return handleError(error);
  }
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

function handleError(error) {
  logger.error("Create order failed", {
    errorName: error.name,
    errorMessage: error.message,
    details: error.details,
  });

  if (error instanceof ValidationError) {
    return response.badRequest({
      message: error.message,
      details: error.details,
    });
  }

  if (error instanceof AppError) {
    return response.internalError({
      message: error.message,
      details: error.details,
    });
  }

  return response.internalError({
    message: "Internal server error",
  });
}

