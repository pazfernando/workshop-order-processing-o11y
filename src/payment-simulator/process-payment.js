require("../shared/otel-bootstrap");

const logger = require("../shared/logger");
const {
  addSpanEvent,
  createInvocationContext,
  durationMs,
  emitMetric,
  forceFlushOpenTelemetry,
  recordException,
  setSpanAttributes,
} = require("../shared/observability");

const FAILURE_MODE = process.env.PAYMENT_FAILURE_MODE || "none";

exports.handler = async (event, context) => {
  const startTime = Date.now();
  const log = logger.createLogger(
    createInvocationContext(event, context, {
      service: "payment-simulator",
      operation: "process-payment",
    })
  );
  const orderId = event.orderId;
  const totalAmount = event.totalAmount;

  setSpanAttributes({
    "app.order_id": orderId,
  });

  log.info("Payment simulation requested", {
    totalAmount,
    failureMode: FAILURE_MODE,
  });

  try {
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
        return buildPaymentResult(orderId, Math.random() < 0.5 ? "REJECTED" : "APPROVED", startTime);
      case "none":
        break;
      default:
        log.warn("Unknown payment failure mode. Falling back to default behavior", {
          failureMode: FAILURE_MODE,
        });
    }

    return buildPaymentResult(orderId, totalAmount <= 1000 ? "APPROVED" : "REJECTED", startTime);
  } catch (error) {
    const latencyMs = durationMs(startTime);

    log.error("Payment simulation failed", {
      errorName: error.name,
      errorMessage: error.message,
      latencyMs,
    });
    emitMetric("PaymentSimulationErrors", 1, {
      service: "payment-simulator",
      operation: "process-payment",
      attributes: {
        "error.type": error.name,
      },
      properties: {
        orderId,
        errorName: error.name,
      },
    });
    recordException(error, {
      "app.operation": "process-payment",
    });

    throw error;
  } finally {
    await forceFlushOpenTelemetry();
  }
};

function buildPaymentResult(orderId, paymentStatus, startTime) {
  const latencyMs = durationMs(startTime);

  emitMetric("PaymentSimulationLatencyMs", latencyMs, {
    service: "payment-simulator",
    operation: "process-payment",
    unit: "Milliseconds",
    attributes: {
      "app.payment_status": paymentStatus,
    },
    properties: {
      orderId,
      paymentStatus,
    },
  });
  emitMetric("PaymentsSimulated", 1, {
    service: "payment-simulator",
    operation: "process-payment",
    attributes: {
      "app.payment_status": paymentStatus,
    },
    properties: {
      orderId,
      paymentStatus,
    },
  });
  addSpanEvent("payment.simulated", {
    "app.order_id": orderId,
    "app.payment_status": paymentStatus,
  });

  return {
    orderId,
    paymentStatus,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
