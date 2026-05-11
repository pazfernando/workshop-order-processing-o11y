const startedSymbol = Symbol.for("workshop-order-processing.otel.started");
const sdkSymbol = Symbol.for("workshop-order-processing.otel.sdk");
const sdkStartPromiseSymbol = Symbol.for("workshop-order-processing.otel.sdk.startPromise");
const logger = require("./logger");

bootstrapOpenTelemetry();

function bootstrapOpenTelemetry() {
  if (global[startedSymbol]) {
    return;
  }

  global[startedSymbol] = true;

  if (!isOtelEnabled()) {
    logBootstrapInfo("OpenTelemetry bootstrap skipped", {
      reason: "observability-otel-disabled",
    });
    return;
  }

  if (isAdotLambdaLayerEnabled()) {
    logBootstrapInfo("OpenTelemetry bootstrap skipped", {
      reason: "adot-lambda-layer-wrapper-active",
      awsLambdaExecWrapper: process.env.AWS_LAMBDA_EXEC_WRAPPER || "",
    });
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
    logBootstrapInfo("OpenTelemetry bootstrap skipped", {
      reason: "no-trace-or-metric-exporters-configured",
      otelExporterOtlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "",
      otelExporterOtlpTracesEndpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || "",
      otelExporterOtlpMetricsEndpoint: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || "",
    });
    return;
  }

  try {
    logBootstrapInfo("OpenTelemetry bootstrap starting", {
      traceExporterConfigured: Boolean(traceExporter),
      metricReaderConfigured: Boolean(metricReader),
      otelExporterOtlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "",
      otelExporterOtlpTracesEndpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || "",
      otelExporterOtlpMetricsEndpoint: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || "",
      otelMetricsExporter: process.env.OTEL_METRICS_EXPORTER || "",
      otelTracesExporter: process.env.OTEL_TRACES_EXPORTER || "",
      otelMetricExportIntervalMs: process.env.OTEL_METRIC_EXPORT_INTERVAL_MS || "",
    });

    const resource = resources.Resource.default().merge(
      new resources.Resource({
        [semanticConventions.ATTR_SERVICE_NAME]:
          process.env.OTEL_SERVICE_NAME || process.env.SERVICE_NAME || "workshop-order-processing",
        [semanticConventions.ATTR_SERVICE_VERSION]: process.env.npm_package_version || "1.0.0",
        "deployment.environment":
          process.env.OTEL_DEPLOYMENT_ENVIRONMENT || process.env.RESOURCE_PREFIX || "local",
      })
    );

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

    global[sdkStartPromiseSymbol] = Promise.resolve(sdk.start())
      .then(() => {
        logBootstrapInfo("OpenTelemetry SDK started", {
          serviceName: process.env.OTEL_SERVICE_NAME || process.env.SERVICE_NAME || "workshop-order-processing",
        });
      })
      .catch((error) => {
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
  logger.error(message, {
    component: "otel-bootstrap",
    errorName: error?.name,
    errorMessage: error?.message,
    stack: error?.stack,
  });

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
  const api = safeRequire("@opentelemetry/api");
  const meterProvider = api?.metrics?.getMeterProvider?.();

  if (!meterProvider || typeof meterProvider.forceFlush !== "function") {
    logger.warn("OpenTelemetry meter provider force flush unavailable", {
      component: "otel-bootstrap",
      serviceName: process.env.OTEL_SERVICE_NAME || process.env.SERVICE_NAME || "workshop-order-processing",
      meterProviderType: meterProvider?.constructor?.name,
    });
    return Promise.resolve();
  }

  return Promise.resolve(meterProvider.forceFlush())
    .then(() => {
      logger.info("OpenTelemetry meter provider force flush completed", {
        component: "otel-bootstrap",
        serviceName: process.env.OTEL_SERVICE_NAME || process.env.SERVICE_NAME || "workshop-order-processing",
        meterProviderType: meterProvider?.constructor?.name,
      });
    })
    .catch((error) => {
      logDiagnostic(api, "Failed to force flush OpenTelemetry meter provider", error);
    });
}

function waitForOpenTelemetry() {
  return Promise.resolve(global[sdkStartPromiseSymbol]);
}

function logBootstrapInfo(message, context = {}) {
  logger.info(message, {
    component: "otel-bootstrap",
    serviceName: process.env.OTEL_SERVICE_NAME || process.env.SERVICE_NAME || "workshop-order-processing",
    ...context,
  });
}

module.exports = {
  forceFlushOpenTelemetry,
  waitForOpenTelemetry,
};
