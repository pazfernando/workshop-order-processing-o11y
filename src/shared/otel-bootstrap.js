const startedSymbol = Symbol.for("workshop-order-processing.otel.started");
const sdkSymbol = Symbol.for("workshop-order-processing.otel.sdk");
const sdkStartPromiseSymbol = Symbol.for("workshop-order-processing.otel.sdk.startPromise");

bootstrapOpenTelemetry();

function bootstrapOpenTelemetry() {
  if (global[startedSymbol]) {
    return;
  }

  global[startedSymbol] = true;

  if (!isOtelEnabled()) {
    return;
  }

  if (isAdotLambdaLayerEnabled()) {
    return;
  }

  const api = safeRequire("@opentelemetry/api");
  const sdkNode = safeRequire("@opentelemetry/sdk-node");
  const httpInstrumentation = safeRequire("@opentelemetry/instrumentation-http");
  const awsLambdaInstrumentation = safeRequire("@opentelemetry/instrumentation-aws-lambda");
  const awsSdkInstrumentation = safeRequire("@opentelemetry/instrumentation-aws-sdk");
  const resources = safeRequire("@opentelemetry/resources");
  const semanticConventions = safeRequire("@opentelemetry/semantic-conventions");
  const traceExporterModule = safeRequire("@opentelemetry/exporter-trace-otlp-http");
  const metricExporterModule = safeRequire("@opentelemetry/exporter-metrics-otlp-http");
  const sdkMetrics = safeRequire("@opentelemetry/sdk-metrics");

  if (
    !api ||
    !sdkNode ||
    !resources ||
    !semanticConventions ||
    !httpInstrumentation ||
    !awsLambdaInstrumentation ||
    !awsSdkInstrumentation
  ) {
    return;
  }

  const traceExporter = buildTraceExporter(traceExporterModule);
  const metricReader = buildMetricReader(metricExporterModule, sdkMetrics);

  if (!traceExporter && !metricReader) {
    return;
  }

  try {
    const resource = resources.resourceFromAttributes({
      [semanticConventions.ATTR_SERVICE_NAME]:
        process.env.OTEL_SERVICE_NAME || process.env.SERVICE_NAME || "workshop-order-processing",
      [semanticConventions.ATTR_SERVICE_VERSION]: process.env.npm_package_version || "1.0.0",
      [semanticConventions.ATTR_DEPLOYMENT_ENVIRONMENT]:
        process.env.OTEL_DEPLOYMENT_ENVIRONMENT || process.env.RESOURCE_PREFIX || "local",
    });

    const sdk = new sdkNode.NodeSDK({
      resource,
      traceExporter,
      metricReader,
      instrumentations: buildInstrumentations(
        httpInstrumentation,
        awsLambdaInstrumentation,
        awsSdkInstrumentation
      ),
    });

    global[sdkSymbol] = sdk;

    global[sdkStartPromiseSymbol] = Promise.resolve(sdk.start()).catch((error) => {
      logDiagnostic(api, "Failed to start OpenTelemetry SDK", error);
    });

    registerShutdown(api, sdk);
  } catch (error) {
    logDiagnostic(api, "Failed to bootstrap OpenTelemetry", error);
  }
}

function buildInstrumentations(httpInstrumentation, awsLambdaInstrumentation, awsSdkInstrumentation) {
  return [
    new httpInstrumentation.HttpInstrumentation(),
    new awsLambdaInstrumentation.AwsLambdaInstrumentation(),
    new awsSdkInstrumentation.AwsInstrumentation(),
  ];
}

function buildTraceExporter(traceExporterModule) {
  if (!hasTraceExportConfig() || !traceExporterModule?.OTLPTraceExporter) {
    return null;
  }

  return new traceExporterModule.OTLPTraceExporter();
}

function buildMetricReader(metricExporterModule, sdkMetrics) {
  if (!hasMetricExportConfig() || !metricExporterModule?.OTLPMetricExporter || !sdkMetrics?.PeriodicExportingMetricReader) {
    return null;
  }

  return new sdkMetrics.PeriodicExportingMetricReader({
    exporter: new metricExporterModule.OTLPMetricExporter(),
    exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS || 10000),
  });
}

function hasTraceExportConfig() {
  return Boolean(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  );
}

function hasMetricExportConfig() {
  return Boolean(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
  );
}

function isOtelEnabled() {
  return parseBoolean(process.env.OBSERVABILITY_OTEL_ENABLED, true);
}

function isAdotLambdaLayerEnabled() {
  return [
    "/opt/otel-handler",
    "/opt/otel-instrument",
  ].includes(process.env.AWS_LAMBDA_EXEC_WRAPPER);
}

function registerShutdown(api, sdk) {
  const shutdown = () =>
    Promise.resolve(sdk.shutdown()).catch((error) => {
      logDiagnostic(api, "Failed to shutdown OpenTelemetry SDK", error);
    });

  process.once("beforeExit", shutdown);
  process.once("SIGTERM", shutdown);
}

function logDiagnostic(api, message, error) {
  if (api?.diag?.error) {
    api.diag.error(message, error);
    return;
  }

  console.error(message, error);
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

function forceFlushOpenTelemetry() {
  const sdk = global[sdkSymbol];

  if (!sdk || typeof sdk.forceFlush !== "function") {
    return Promise.resolve();
  }

  return Promise.resolve(sdk.forceFlush()).catch((error) => {
    const api = safeRequire("@opentelemetry/api");
    logDiagnostic(api, "Failed to force flush OpenTelemetry SDK", error);
  });
}

function waitForOpenTelemetry() {
  return Promise.resolve(global[sdkStartPromiseSymbol]);
}

module.exports = {
  forceFlushOpenTelemetry,
  waitForOpenTelemetry,
};
