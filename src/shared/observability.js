const crypto = require("node:crypto");

const otelApi = safeRequire("@opentelemetry/api");
const { forceFlushOpenTelemetry, waitForOpenTelemetry } = require("./otel-bootstrap");

let coldStart = true;
const otelInstruments = new Map();

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

  const context = cleanContext({
    ...baseContext,
    awsRequestId: lambdaContext?.awsRequestId,
    requestId,
    correlationId,
    traceId: extractTraceId(process.env._X_AMZN_TRACE_ID),
    coldStart: consumeColdStart(),
    routeKey: event?.requestContext?.routeKey,
    httpMethod: event?.requestContext?.http?.method,
    path: event?.requestContext?.http?.path,
    sourceIp: event?.requestContext?.http?.sourceIp,
    userAgent: event?.requestContext?.http?.userAgent,
  });

  enrichActiveSpan(context);
  return context;
}

function createEventContext(event, lambdaContext, baseContext = {}) {
  const detail = event?.detail || {};
  const correlationId = detail.correlationId || lambdaContext?.awsRequestId || crypto.randomUUID();

  const context = cleanContext({
    ...baseContext,
    awsRequestId: lambdaContext?.awsRequestId,
    correlationId,
    requestId: detail.requestId,
    traceId: extractTraceId(process.env._X_AMZN_TRACE_ID),
    coldStart: consumeColdStart(),
    eventId: event?.id,
    eventSource: event?.source,
    detailType: event?.["detail-type"],
    orderId: detail.orderId,
  });

  enrichActiveSpan(context);
  return context;
}

function createInvocationContext(payload, lambdaContext, baseContext = {}) {
  const correlationId = payload?.correlationId || lambdaContext?.awsRequestId || crypto.randomUUID();

  const context = cleanContext({
    ...baseContext,
    awsRequestId: lambdaContext?.awsRequestId,
    correlationId,
    requestId: payload?.requestId,
    traceId: extractTraceId(process.env._X_AMZN_TRACE_ID),
    coldStart: consumeColdStart(),
    orderId: payload?.orderId,
  });

  enrichActiveSpan(context);
  return context;
}

function emitMetric(name, value, options = {}) {
  recordOtelMetric(name, value, options);

  if (!shouldEmitEmfCompatibility()) {
    return;
  }

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

function setSpanAttributes(attributes) {
  const span = otelApi?.trace?.getActiveSpan?.();
  const normalizedAttributes = normalizeAttributes(attributes);

  if (!span || Object.keys(normalizedAttributes).length === 0) {
    return;
  }

  span.setAttributes(normalizedAttributes);
}

function addSpanEvent(name, attributes = {}) {
  const span = otelApi?.trace?.getActiveSpan?.();

  if (!span) {
    return;
  }

  span.addEvent(name, normalizeAttributes(attributes));
}

function recordException(error, attributes = {}) {
  const span = otelApi?.trace?.getActiveSpan?.();

  if (!span) {
    return;
  }

  span.recordException(error);

  if (otelApi?.SpanStatusCode?.ERROR) {
    span.setStatus({
      code: otelApi.SpanStatusCode.ERROR,
      message: error.message,
    });
  }

  if (Object.keys(attributes).length > 0) {
    span.setAttributes(normalizeAttributes(attributes));
  }
}

function recordOtelMetric(name, value, options) {
  const meter = getMeter();

  if (!meter) {
    return;
  }

  const instrumentType = resolveInstrumentType(options);
  const cacheKey = [
    instrumentType,
    name,
    normalizeOtelUnit(options.unit),
  ].join(":");
  let instrument = otelInstruments.get(cacheKey);

  if (!instrument) {
    const definition = {
      description: options.description,
      unit: normalizeOtelUnit(options.unit),
    };

    instrument =
      instrumentType === "histogram"
        ? meter.createHistogram(name, definition)
        : meter.createCounter(name, definition);

    otelInstruments.set(cacheKey, instrument);
  }

  const attributes = normalizeAttributes({
    "service.name": options.service || process.env.SERVICE_NAME || "unknown-service",
    "app.operation": options.operation || "unknown-operation",
    ...(options.dimensions || {}),
    ...(options.attributes || {}),
  });

  if (instrumentType === "histogram") {
    instrument.record(value, attributes);
    return;
  }

  instrument.add(value, attributes);
}

function enrichActiveSpan(observabilityContext) {
  setSpanAttributes({
    "service.name": observabilityContext.service,
    "app.operation": observabilityContext.operation,
    "app.correlation_id": observabilityContext.correlationId,
    "app.order_id": observabilityContext.orderId,
    "aws.lambda.request_id": observabilityContext.awsRequestId,
    "faas.coldstart": observabilityContext.coldStart,
    "http.route": observabilityContext.routeKey,
    "http.request.method": observabilityContext.httpMethod,
    "url.path": observabilityContext.path,
    "client.address": observabilityContext.sourceIp,
    "user_agent.original": observabilityContext.userAgent,
    "messaging.message.id": observabilityContext.eventId,
    "messaging.operation": observabilityContext.detailType ? "process" : undefined,
  });
}

function getMeter() {
  if (!otelApi?.metrics?.getMeter) {
    return null;
  }

  return otelApi.metrics.getMeter(
    process.env.OTEL_METER_NAME || process.env.SERVICE_NAME || "workshop-order-processing",
    process.env.npm_package_version || "1.0.0"
  );
}

function normalizeAttributes(attributes) {
  return Object.fromEntries(
    Object.entries(attributes || {}).filter(([, value]) =>
      value !== undefined &&
      value !== null &&
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    )
  );
}

function normalizeOtelUnit(unit) {
  switch (unit) {
    case "Milliseconds":
      return "ms";
    case "Seconds":
      return "s";
    case "Count":
    case undefined:
      return "1";
    default:
      return unit;
  }
}

function resolveInstrumentType(options = {}) {
  if (options.instrument) {
    return options.instrument;
  }

  const normalizedUnit = normalizeOtelUnit(options.unit);

  if (normalizedUnit === "ms" || normalizedUnit === "s") {
    return "histogram";
  }

  return "counter";
}

function shouldEmitEmfCompatibility() {
  return parseBoolean(process.env.OBSERVABILITY_EMF_COMPATIBILITY_MODE, true);
}

function parseBoolean(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }

  return String(value).toLowerCase() === "true";
}

function safeRequire(moduleName) {
  try {
    return require(moduleName);
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND" && error.message.includes(moduleName)) {
      return null;
    }

    throw error;
  }
}

function extractTraceId(traceHeader) {
  if (!traceHeader) {
    return undefined;
  }

  const rootMatch = String(traceHeader).match(/Root=([^;]+)/);
  return rootMatch ? rootMatch[1] : traceHeader;
}

module.exports = {
  addSpanEvent,
  createEventContext,
  createHttpContext,
  createInvocationContext,
  durationMs,
  emitMetric,
  forceFlushOpenTelemetry,
  recordException,
  setSpanAttributes,
  waitForOpenTelemetry,
};
