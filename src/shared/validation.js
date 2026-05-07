const { ValidationError } = require("./errors");

function assertString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${fieldName} is required`);
  }
}

function assertPositiveNumber(value, fieldName) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    throw new ValidationError(`${fieldName} must be greater than 0`);
  }
}

function validateOrderPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new ValidationError("Request body must be a valid JSON object");
  }

  assertString(payload.customerId, "customerId");
  assertString(payload.currency, "currency");

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new ValidationError("items must contain at least one item");
  }

  payload.items.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      throw new ValidationError(`items[${index}] must be an object`);
    }

    assertString(item.sku, `items[${index}].sku`);
    assertPositiveNumber(item.quantity, `items[${index}].quantity`);
    assertPositiveNumber(item.unitPrice, `items[${index}].unitPrice`);
  });
}

function calculateTotalAmount(items) {
  return Number(
    items
      .reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
      .toFixed(2)
  );
}

module.exports = {
  validateOrderPayload,
  calculateTotalAmount,
};

