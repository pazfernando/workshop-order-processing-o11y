const otelApi = safeRequire("@opentelemetry/api");
const { emitLogRecord, forceFlushOpenTelemetry, waitForOpenTelemetry } = require("./otel-bootstrap");
const requestContext = require("./request-context");

let coldStart = true;
const instruments = new Map();

function createHttpContext(event, lambdaContext, baseContext = {}) {
  const context = {
    ...requestContext.createHttpContext(event, lambdaContext, baseContext),
    traceId: getCurrentTraceId(),
    coldStart: consumeColdStart(),
  };

  enrichActiveSpan(context);
  return cleanContext(context);
}

function createEventContext(event, lambdaContext, baseContext = {}) {
  const detail = event?.detail || {};
  const context = {
    ...requestContext.createEventContext(event, lambdaContext, baseContext),
    traceId: getCurrentTraceId(),
    coldStart: consumeColdStart(),
    parentTraceContext: detail.traceContext,
  };

  enrichActiveSpan(context);
  return cleanContext(context);
}

function createInvocationContext(payload, lambdaContext, baseContext = {}) {
  const context = {
    ...requestContext.createInvocationContext(payload, lambdaContext, baseContext),
    traceId: getCurrentTraceId(),
    coldStart: consumeColdStart(),
    parentTraceContext: payload?.traceContext,
  };

  enrichActiveSpan(context);
  return cleanContext(context);
}

function recordHttpServerMetrics(context, { statusCode, latencyMs }) {
  const normalizedStatusCode = Number(statusCode) || 500;
  const attributes = {
    "http.route": context.routeKey || context.path || "unknown",
    "http.request.method": context.httpMethod || "UNKNOWN",
    "http.response.status_code": normalizedStatusCode,
  };

  recordMetric("HttpServerRequestCount", 1, {
    unit: "{request}",
    description: "Total HTTP requests handled by the serverless API.",
    attributes,
  });

  recordMetric("HttpServerRequestDuration", latencyMs, {
    instrument: "histogram",
    unit: "ms",
    description: "End-to-end HTTP request latency for the serverless API.",
    attributes,
  });

  if (normalizedStatusCode >= 500) {
    recordMetric("HttpServerRequestErrors", 1, {
      unit: "{error}",
      description: "HTTP requests that completed with server-side failure conditions.",
      attributes,
    });
  }

  if (shouldEmitEmfCompatibility()) {
    emitEmfMetric("HttpServerRequestCount", 1, attributes, "{request}");
    emitEmfMetric("HttpServerRequestDuration", latencyMs, attributes, "Milliseconds");

    if (normalizedStatusCode >= 500) {
      emitEmfMetric("HttpServerRequestErrors", 1, attributes, "{error}");
    }
  }
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

  if (!span || typeof span.addEvent !== "function") {
    return;
  }

  span.addEvent(name, normalizeAttributes(attributes));
}

function injectTraceContext(carrier = {}) {
  if (!otelApi?.propagation?.inject || !otelApi?.context?.active) {
    return carrier;
  }

  otelApi.propagation.inject(otelApi.context.active(), carrier);
  return carrier;
}

function extractTraceContext(carrier = {}) {
  if (!otelApi?.propagation?.extract || !otelApi?.ROOT_CONTEXT) {
    return undefined;
  }

  return otelApi.propagation.extract(otelApi.ROOT_CONTEXT, carrier);
}

async function runWithActiveSpan(name, options = {}, callback) {
  const tracer = otelApi?.trace?.getTracer?.(
    process.env.OTEL_TRACER_NAME || process.env.SERVICE_NAME || "workshop-order-processing",
    process.env.npm_package_version || "1.0.0"
  );

  if (!tracer || typeof tracer.startActiveSpan !== "function") {
    return callback();
  }

  const parentContext = options.parentContext || otelApi?.context?.active?.();
  const spanOptions = {
    kind: resolveSpanKind(options.kind),
    attributes: normalizeAttributes(options.attributes),
  };

  return otelApi.context.with(parentContext, () =>
    tracer.startActiveSpan(name, spanOptions, async (span) => {
      try {
        return await callback(span);
      } catch (error) {
        recordException(error);
        throw error;
      } finally {
        span.end();
      }
    })
  );
}

function recordException(error, attributes = {}) {
  const span = otelApi?.trace?.getActiveSpan?.();

  if (!span) {
    return;
  }

  if (typeof span.recordException === "function") {
    span.recordException(error);
  }

  if (otelApi?.SpanStatusCode?.ERROR && typeof span.setStatus === "function") {
    span.setStatus({
      code: otelApi.SpanStatusCode.ERROR,
      message: error?.message,
    });
  }

  if (Object.keys(attributes).length > 0) {
    span.setAttributes(normalizeAttributes(attributes));
  }
}

function emitStructuredLog(level, message, context) {
  emitLogRecord(level, message, context);
}

function flushOpenTelemetryWithDiagnostics(context = {}) {
  logOtelFlush("OpenTelemetry export attempt starting", context);

  return forceFlushOpenTelemetry().then((result) => {
    logOtelFlush("OpenTelemetry export attempt completed", {
      ...context,
      otelFlushCompleted: Boolean(result?.flushed),
      otelFlushSkipped: Boolean(result?.skipped),
      otelFlushReason: result?.reason,
      otelFlushErrorName: result?.errorName,
      otelFlushErrorMessage: result?.errorMessage,
    });

    return result;
  });
}

function recordMetric(name, value, options = {}) {
  const meter = getMeter();

  if (!meter) {
    return;
  }

  const instrumentType = options.instrument || (options.unit === "ms" ? "histogram" : "counter");
  const cacheKey = `${instrumentType}:${name}:${options.unit || "1"}`;
  let instrument = instruments.get(cacheKey);

  if (!instrument) {
    const definition = {
      description: options.description,
      unit: options.unit,
    };

    instrument =
      instrumentType === "histogram"
        ? meter.createHistogram(name, definition)
        : meter.createCounter(name, definition);

    instruments.set(cacheKey, instrument);
  }

  const attributes = normalizeAttributes(options.attributes);
  if (instrumentType === "histogram") {
    instrument.record(value, attributes);
    return;
  }

  instrument.add(value, attributes);
}

function emitEmfMetric(name, value, attributes, unit) {
  const metricEntry = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: process.env.METRICS_NAMESPACE || "Workshop/OrderProcessing",
          Dimensions: [["httpRoute", "httpMethod", "statusCode"]],
          Metrics: [
            {
              Name: name,
              Unit: unit,
            },
          ],
        },
      ],
    },
    httpRoute: attributes["http.route"],
    httpMethod: attributes["http.request.method"],
    statusCode: String(attributes["http.response.status_code"]),
    [name]: value,
  };

  console.log(JSON.stringify(metricEntry));
}

function enrichActiveSpan(context) {
  setSpanAttributes({
    "service.name": readResourceAttribute("service.name"),
    "service.namespace": readResourceAttribute("service.namespace"),
    "deployment.environment": readResourceAttribute("deployment.environment"),
    "app.correlation_id": context.correlationId,
    "app.order_id": context.orderId,
    "aws.lambda.request_id": context.awsRequestId,
    "faas.coldstart": context.coldStart,
    "http.route": context.routeKey,
    "http.request.method": context.httpMethod,
    "url.path": context.path,
    "client.address": context.sourceIp,
    "user_agent.original": context.userAgent,
    "messaging.message.id": context.eventId,
    "messaging.operation": context.detailType ? "process" : undefined,
  });
}

function shouldEmitEmfCompatibility() {
  return parseBoolean(process.env.OBSERVABILITY_EMF_COMPATIBILITY_MODE, true);
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

function getCurrentTraceId() {
  const activeSpan = otelApi?.trace?.getActiveSpan?.();
  const activeTraceId = activeSpan?.spanContext?.()?.traceId;

  if (activeTraceId) {
    return activeTraceId;
  }

  return extractTraceId(process.env._X_AMZN_TRACE_ID);
}

function readResourceAttribute(name) {
  const pairs = String(process.env.OTEL_RESOURCE_ATTRIBUTES || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const pair of pairs) {
    const [key, ...rest] = pair.split("=");
    if (key === name) {
      return rest.join("=");
    }
  }

  if (name === "service.name") {
    return process.env.SERVICE_NAME || "workshop-order-processing";
  }

  if (name === "deployment.environment") {
    return process.env.RESOURCE_PREFIX || "local";
  }

  return undefined;
}

function cleanContext(context) {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined)
  );
}

function consumeColdStart() {
  const value = coldStart;
  coldStart = false;
  return value;
}

function resolveSpanKind(kind) {
  if (!otelApi?.SpanKind || !kind) {
    return kind;
  }

  if (typeof kind === "number") {
    return kind;
  }

  return otelApi.SpanKind[kind] || undefined;
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

function parseBoolean(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }

  return String(value).trim().toLowerCase() === "true";
}

function logOtelFlush(message, context = {}) {
  console.log(JSON.stringify(cleanContext({
    level: "INFO",
    message,
    timestamp: new Date().toISOString(),
    component: "otel-export",
    serviceName: readResourceAttribute("service.name") || process.env.SERVICE_NAME || "workshop-order-processing",
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otlpTracesEndpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    otlpMetricsEndpoint: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    otlpLogsEndpoint: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
    ...context,
  })));
}

function extractTraceId(traceHeader) {
  if (!traceHeader) {
    return undefined;
  }

  const rootMatch = String(traceHeader).match(/Root=([^;]+)/);
  return rootMatch ? rootMatch[1] : traceHeader;
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

module.exports = {
  addSpanEvent,
  buildResponseHeaders: requestContext.buildResponseHeaders,
  createEventContext,
  createHttpContext,
  createInvocationContext,
  durationMs: requestContext.durationMs,
  emitStructuredLog,
  extractTraceContext,
  flushOpenTelemetryWithDiagnostics,
  forceFlushOpenTelemetry,
  injectTraceContext,
  recordException,
  recordHttpServerMetrics,
  runWithActiveSpan,
  setSpanAttributes,
  waitForOpenTelemetry,
};
