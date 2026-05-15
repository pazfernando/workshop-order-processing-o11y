const logger = require("../shared/logger");
const {
  createInvocationContext,
  durationMs,
  extractTraceContext,
  recordException,
  runWithActiveSpan,
  triggerOpenTelemetryFlush,
} = require("../shared/observability");

const FAILURE_MODE = process.env.PAYMENT_FAILURE_MODE || "none";

exports.handler = async (event, context) => {
  const parentContext = extractTraceContext(event.traceContext || {});

  return runWithActiveSpan(
    "payment-simulator",
    {
      kind: "INTERNAL",
      parentContext,
    },
    async () => {
      const startTime = Date.now();
      const requestObservabilityContext = createInvocationContext(event, context, {
        service: "payment-simulator",
        operation: "process-payment",
      });
      const log = logger.createLogger(requestObservabilityContext);
      const orderId = event.orderId;
      const totalAmount = event.totalAmount;

      try {
        log.info("Payment simulation requested", {
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
            return buildPaymentResult(orderId, Math.random() < 0.5 ? "REJECTED" : "APPROVED", startTime, log);
          case "none":
            break;
          default:
            log.warn("Unknown payment failure mode. Falling back to default behavior", {
              failureMode: FAILURE_MODE,
            });
        }

        return buildPaymentResult(orderId, totalAmount <= 1000 ? "APPROVED" : "REJECTED", startTime, log);
      } catch (error) {
        recordException(error, {
          "app.operation": requestObservabilityContext.operation,
          "app.order_id": orderId,
        });

        log.error("Payment simulation failed", {
          errorName: error.name,
          errorMessage: error.message,
          latencyMs: durationMs(startTime),
        });

        throw error;
      } finally {
        triggerOpenTelemetryFlush({
          operation: requestObservabilityContext.operation,
          requestId: requestObservabilityContext.requestId,
          correlationId: requestObservabilityContext.correlationId,
          orderId,
        });
      }
    }
  );
};

function buildPaymentResult(orderId, paymentStatus, startTime, log) {
  log.info("Payment simulation completed", {
    orderId,
    paymentStatus,
    latencyMs: durationMs(startTime),
  });

  return {
    orderId,
    paymentStatus,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
