const crypto = require("node:crypto");

let coldStart = true;

function getHeader(event, headerName) {
  if (!event || !event.headers) {
    return undefined;
  }

  const target = headerName.toLowerCase();
  const match = Object.keys(event.headers).find((key) => key.toLowerCase() === target);

  return match ? event.headers[match] : undefined;
}

function consumeColdStart() {
  const value = coldStart;
  coldStart = false;
  return value;
}

function createHttpContext(event, lambdaContext, baseContext = {}) {
  const requestId = event?.requestContext?.requestId || lambdaContext?.awsRequestId;
  const correlationId = getHeader(event, "x-correlation-id") || requestId || crypto.randomUUID();

  return cleanContext({
    ...baseContext,
    awsRequestId: lambdaContext?.awsRequestId,
    requestId,
    correlationId,
    traceId: process.env._X_AMZN_TRACE_ID,
    coldStart: consumeColdStart(),
    routeKey: event?.requestContext?.routeKey,
    httpMethod: event?.requestContext?.http?.method,
    path: event?.requestContext?.http?.path,
    sourceIp: event?.requestContext?.http?.sourceIp,
    userAgent: event?.requestContext?.http?.userAgent,
  });
}

function createEventContext(event, lambdaContext, baseContext = {}) {
  const detail = event?.detail || {};
  const correlationId = detail.correlationId || lambdaContext?.awsRequestId || crypto.randomUUID();

  return cleanContext({
    ...baseContext,
    awsRequestId: lambdaContext?.awsRequestId,
    correlationId,
    requestId: detail.requestId,
    traceId: process.env._X_AMZN_TRACE_ID,
    coldStart: consumeColdStart(),
    eventId: event?.id,
    eventSource: event?.source,
    detailType: event?.["detail-type"],
    orderId: detail.orderId,
  });
}

function createInvocationContext(payload, lambdaContext, baseContext = {}) {
  const correlationId = payload?.correlationId || lambdaContext?.awsRequestId || crypto.randomUUID();

  return cleanContext({
    ...baseContext,
    awsRequestId: lambdaContext?.awsRequestId,
    correlationId,
    requestId: payload?.requestId,
    traceId: process.env._X_AMZN_TRACE_ID,
    coldStart: consumeColdStart(),
    orderId: payload?.orderId,
  });
}

function emitMetric(name, value, options = {}) {
  const namespace = options.namespace || process.env.METRICS_NAMESPACE || "Workshop/OrderProcessing";
  const dimensions = {
    service: options.service || process.env.SERVICE_NAME || "unknown-service",
    operation: options.operation || "unknown-operation",
    ...(options.dimensions || {}),
  };

  const dimensionKeys = Object.keys(dimensions);
  const metricEntry = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: namespace,
          Dimensions: [dimensionKeys],
          Metrics: [
            {
              Name: name,
              Unit: options.unit || "Count",
            },
          ],
        },
      ],
    },
    ...dimensions,
    ...(options.properties || {}),
    [name]: value,
  };

  console.log(JSON.stringify(metricEntry));
}

function durationMs(startTimeMs) {
  return Date.now() - startTimeMs;
}

function cleanContext(context) {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined)
  );
}

module.exports = {
  createEventContext,
  createHttpContext,
  createInvocationContext,
  durationMs,
  emitMetric,
};
