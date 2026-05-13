const crypto = require("node:crypto");

function getHeader(event, headerName) {
  if (!event || !event.headers) {
    return undefined;
  }

  const target = headerName.toLowerCase();
  const match = Object.keys(event.headers).find((key) => key.toLowerCase() === target);

  return match ? event.headers[match] : undefined;
}

function cleanContext(context) {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined)
  );
}

function createHttpContext(event, lambdaContext, baseContext = {}) {
  const requestId = event?.requestContext?.requestId || lambdaContext?.awsRequestId;
  const correlationId = getHeader(event, "x-correlation-id") || requestId || crypto.randomUUID();

  return cleanContext({
    ...baseContext,
    awsRequestId: lambdaContext?.awsRequestId,
    requestId,
    correlationId,
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
    orderId: payload?.orderId,
  });
}

function buildResponseHeaders(context) {
  return {
    "x-correlation-id": context.correlationId,
  };
}

function durationMs(startTimeMs) {
  return Date.now() - startTimeMs;
}

module.exports = {
  buildResponseHeaders,
  createEventContext,
  createHttpContext,
  createInvocationContext,
  durationMs,
};
