const logger = require("../shared/logger");

const FAILURE_MODE = process.env.PAYMENT_FAILURE_MODE || "none";

exports.handler = async (event) => {
  const orderId = event.orderId;
  const totalAmount = event.totalAmount;

  logger.info("Payment simulation requested", {
    orderId,
    totalAmount,
    failureMode: FAILURE_MODE,
  });

  switch (FAILURE_MODE) {
    case "always_fail":
      throw new Error("Payment simulator forced failure");
    case "random_fail":
      if (Math.random() < 0.3) {
        throw new Error("Payment simulator random failure");
      }
      break;
    case "slow_response":
      await sleep(4000);
      break;
    case "random_reject":
      return {
        orderId,
        paymentStatus: Math.random() < 0.5 ? "REJECTED" : "APPROVED",
      };
    case "none":
      break;
    default:
      logger.warn("Unknown payment failure mode. Falling back to default behavior", {
        failureMode: FAILURE_MODE,
      });
  }

  return {
    orderId,
    paymentStatus: totalAmount <= 1000 ? "APPROVED" : "REJECTED",
  };
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

