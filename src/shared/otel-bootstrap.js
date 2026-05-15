const startedSymbol = Symbol.for("workshop-order-processing.otel.started");
const sdkPromiseSymbol = Symbol.for("workshop-order-processing.otel.sdk.promise");
const sdkInstanceSymbol = Symbol.for("workshop-order-processing.otel.sdk.instance");

bootstrapOpenTelemetry();

function bootstrapOpenTelemetry() {
  if (global[startedSymbol]) {
    return;
  }

  global[startedSymbol] = true;

  if (!isOtelEnabled()) {
    logBootstrap("INFO", "OpenTelemetry bootstrap skipped", {
      reason: "observability-otel-disabled",
    });
    return;
  }

  if (isAdotLambdaLayerEnabled()) {
    logBootstrap("INFO", "OpenTelemetry bootstrap skipped", {
      reason: "adot-lambda-layer-wrapper-active",
      awsLambdaExecWrapper: process.env.AWS_LAMBDA_EXEC_WRAPPER || "",
    });
    return;
  }

  const api = safeRequire("@opentelemetry/api");
  const apiLogs = safeRequire("@opentelemetry/api-logs");
  const sdkNode = safeRequire("@opentelemetry/sdk-node");
  const sdkLogs = safeRequire("@opentelemetry/sdk-logs");
  const sdkMetrics = safeRequire("@opentelemetry/sdk-metrics");
  const traceExporterModule = safeRequire("@opentelemetry/exporter-trace-otlp-http");
  const metricExporterModule = safeRequire("@opentelemetry/exporter-metrics-otlp-http");
  const logExporterModule = safeRequire("@opentelemetry/exporter-logs-otlp-http");
  const httpInstrumentation = safeRequire("@opentelemetry/instrumentation-http");
  const awsLambdaInstrumentation = safeRequire("@opentelemetry/instrumentation-aws-lambda");
  const awsSdkInstrumentation = safeRequire("@opentelemetry/instrumentation-aws-sdk");

  const missingDependencies = [
    ["@opentelemetry/api", api],
    ["@opentelemetry/api-logs", apiLogs],
    ["@opentelemetry/sdk-node", sdkNode],
    ["@opentelemetry/sdk-logs", sdkLogs],
    ["@opentelemetry/sdk-metrics", sdkMetrics],
    ["@opentelemetry/exporter-trace-otlp-http", traceExporterModule],
    ["@opentelemetry/exporter-metrics-otlp-http", metricExporterModule],
    ["@opentelemetry/exporter-logs-otlp-http", logExporterModule],
    ["@opentelemetry/instrumentation-http", httpInstrumentation],
    ["@opentelemetry/instrumentation-aws-lambda", awsLambdaInstrumentation],
    ["@opentelemetry/instrumentation-aws-sdk", awsSdkInstrumentation],
  ]
    .filter(([, moduleValue]) => !moduleValue)
    .map(([moduleName]) => moduleName);

  if (missingDependencies.length > 0) {
    logBootstrap("WARN", "OpenTelemetry bootstrap skipped", {
      reason: "missing-otel-dependencies",
      missingDependencies,
    });
    return;
  }

  const traceExporter = buildTraceExporter(traceExporterModule);
  const metricReader = buildMetricReader(metricExporterModule, sdkMetrics);
  const logRecordProcessors = buildLogRecordProcessors(logExporterModule, sdkLogs);

  if (!traceExporter && !metricReader && logRecordProcessors.length === 0) {
    logBootstrap("INFO", "OpenTelemetry bootstrap skipped", {
      reason: "no-supported-exporters-configured",
      exportStrategy: process.env.OTEL_EXPORT_STRATEGY || "",
      tracesExporter: process.env.OTEL_TRACES_EXPORTER || "",
      metricsExporter: process.env.OTEL_METRICS_EXPORTER || "",
      logsExporter: process.env.OTEL_LOGS_EXPORTER || "",
    });
    return;
  }

  try {
    const sdk = new sdkNode.NodeSDK({
      traceExporter,
      metricReader,
      logRecordProcessors,
      instrumentations: buildInstrumentations(
        httpInstrumentation,
        awsLambdaInstrumentation,
        awsSdkInstrumentation
      ),
    });

    global[sdkInstanceSymbol] = sdk;
    global[sdkPromiseSymbol] = Promise.resolve(sdk.start())
      .then(() => {
        logBootstrap("INFO", "OpenTelemetry SDK started", {
          tracesExporterConfigured: Boolean(traceExporter),
          metricReaderConfigured: Boolean(metricReader),
          logExporterConfigured: logRecordProcessors.length > 0,
        });
      })
      .catch((error) => {
        logBootstrap("ERROR", "Failed to start OpenTelemetry SDK", {
          errorName: error?.name,
          errorMessage: error?.message,
          stack: error?.stack,
        });
      });

    registerShutdown(sdk);
  } catch (error) {
    logBootstrap("ERROR", "Failed to bootstrap OpenTelemetry", {
      errorName: error?.name,
      errorMessage: error?.message,
      stack: error?.stack,
    });
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
  if (!isSignalEnabled("OTEL_TRACES_EXPORTER") || !hasTraceExportConfig()) {
    return null;
  }

  const traceEndpoint = resolveSignalEndpoint("traces");
  if (targetsAwsManagedEndpoint(traceEndpoint)) {
    logBootstrap("WARN", "Skipping code-mode trace exporter for AWS-managed OTLP endpoint", {
      reason: "aws-sigv4-endpoint-requires-platform-runtime",
      signal: "traces",
      endpoint: traceEndpoint,
    });
    return null;
  }

  return new traceExporterModule.OTLPTraceExporter();
}

function buildMetricReader(metricExporterModule, sdkMetrics) {
  if (!isSignalEnabled("OTEL_METRICS_EXPORTER") || !hasMetricExportConfig()) {
    return null;
  }

  const metricEndpoint = resolveSignalEndpoint("metrics");
  if (targetsAwsManagedEndpoint(metricEndpoint)) {
    logBootstrap("WARN", "Skipping code-mode metric exporter for AWS-managed OTLP endpoint", {
      reason: "aws-sigv4-endpoint-requires-platform-runtime",
      signal: "metrics",
      endpoint: metricEndpoint,
    });
    return null;
  }

  return new sdkMetrics.PeriodicExportingMetricReader({
    exporter: new metricExporterModule.OTLPMetricExporter(),
    exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS || 10000),
  });
}

function buildLogRecordProcessors(logExporterModule, sdkLogs) {
  if (!isSignalEnabled("OTEL_LOGS_EXPORTER") || !hasLogExportConfig()) {
    return [];
  }

  const logEndpoint = resolveSignalEndpoint("logs");
  if (targetsAwsManagedEndpoint(logEndpoint)) {
    logBootstrap("WARN", "Skipping code-mode log exporter for AWS-managed OTLP endpoint", {
      reason: "aws-sigv4-endpoint-requires-platform-runtime",
      signal: "logs",
      endpoint: logEndpoint,
    });
    return [];
  }

  return [
    new sdkLogs.BatchLogRecordProcessor(new logExporterModule.OTLPLogExporter()),
  ];
}

function emitLogRecord(levelName, message, attributes = {}) {
  if (!isOtelEnabled()) {
    return;
  }

  const apiLogs = safeRequire("@opentelemetry/api-logs");
  const logger = apiLogs?.logs?.getLogger?.(
    process.env.OTEL_LOGGER_NAME || process.env.SERVICE_NAME || "workshop-order-processing",
    process.env.npm_package_version || "1.0.0"
  );

  if (!logger || typeof logger.emit !== "function") {
    return;
  }

  logger.emit({
    severityNumber: resolveSeverityNumber(levelName),
    severityText: levelName,
    body: message,
    attributes: normalizeAttributes(attributes),
  });
}

function waitForOpenTelemetry() {
  return Promise.resolve(global[sdkPromiseSymbol]);
}

function forceFlushOpenTelemetry() {
  const traceApi = safeRequire("@opentelemetry/api");
  const logsApi = safeRequire("@opentelemetry/api-logs");
  const flushTargets = [
    {
      name: "traces",
      provider: traceApi?.trace?.getTracerProvider?.(),
    },
    {
      name: "metrics",
      provider: traceApi?.metrics?.getMeterProvider?.(),
    },
    {
      name: "logs",
      provider: logsApi?.logs?.getLoggerProvider?.(),
    },
  ];

  const flushableTargets = flushTargets.filter(({ provider }) => typeof provider?.forceFlush === "function");

  if (flushableTargets.length === 0) {
    const sdk = global[sdkInstanceSymbol];
    if (sdk && typeof sdk.forceFlush === "function") {
      return Promise.resolve(sdk.forceFlush())
        .then(() => ({
          flushed: true,
          skipped: false,
          flushedSignals: ["sdk"],
        }))
        .catch((error) => buildFlushFailure("sdk-forceflush-failed", error));
    }

    return Promise.resolve({
      flushed: false,
      skipped: true,
      reason: "no-flushable-provider-available",
    });
  }

  return Promise.all(
    flushableTargets.map(async ({ name, provider }) => {
      await provider.forceFlush();
      return name;
    })
  )
    .then((flushedSignals) => ({
      flushed: true,
      skipped: false,
      flushedSignals,
    }))
    .catch((error) => buildFlushFailure("provider-forceflush-failed", error));
}

function isSignalEnabled(envName) {
  const value = String(process.env[envName] || "").trim().toLowerCase();
  return value !== "" && value !== "none";
}

function hasTraceExportConfig() {
  return Boolean(resolveSignalEndpoint("traces"));
}

function hasMetricExportConfig() {
  return Boolean(resolveSignalEndpoint("metrics"));
}

function hasLogExportConfig() {
  return Boolean(resolveSignalEndpoint("logs"));
}

function resolveSignalEndpoint(signal) {
  const signalSpecific = process.env[`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_ENDPOINT`] || "";
  if (signalSpecific.trim()) {
    return signalSpecific.trim();
  }

  const baseEndpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "").trim();
  if (!baseEndpoint) {
    return "";
  }

  if (signal === "traces") {
    return `${baseEndpoint.replace(/\/$/, "")}/v1/traces`;
  }
  if (signal === "metrics") {
    return `${baseEndpoint.replace(/\/$/, "")}/v1/metrics`;
  }
  if (signal === "logs") {
    return `${baseEndpoint.replace(/\/$/, "")}/v1/logs`;
  }

  return baseEndpoint;
}

function targetsAwsManagedEndpoint(endpoint) {
  return endpoint.includes(".amazonaws.com/");
}

function isOtelEnabled() {
  return parseBoolean(process.env.OBSERVABILITY_OTEL_ENABLED, true);
}

function isAdotLambdaLayerEnabled() {
  return ["/opt/otel-handler", "/opt/otel-instrument"].includes(process.env.AWS_LAMBDA_EXEC_WRAPPER);
}

function parseBoolean(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }

  return String(value).trim().toLowerCase() === "true";
}

function registerShutdown(sdk) {
  const shutdown = () =>
    Promise.resolve(sdk.shutdown()).catch((error) => {
      logBootstrap("ERROR", "Failed to shutdown OpenTelemetry SDK", {
        errorName: error?.name,
        errorMessage: error?.message,
        stack: error?.stack,
      });
    });

  process.once("beforeExit", shutdown);
  process.once("SIGTERM", shutdown);
}

function resolveSeverityNumber(levelName) {
  switch (String(levelName || "").toUpperCase()) {
    case "DEBUG":
      return 5;
    case "INFO":
      return 9;
    case "WARN":
      return 13;
    case "ERROR":
      return 17;
    default:
      return 9;
  }
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

function buildFlushFailure(reason, error) {
  logBootstrap("ERROR", "Failed to force flush OpenTelemetry", {
    errorName: error?.name,
    errorMessage: error?.message,
    stack: error?.stack,
  });

  return {
    flushed: false,
    skipped: false,
    reason,
    errorName: error?.name,
    errorMessage: error?.message,
  };
}

function logBootstrap(level, message, context = {}) {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    component: "otel-bootstrap",
    serviceName: process.env.SERVICE_NAME || "workshop-order-processing",
    ...context,
  };

  console.log(JSON.stringify(entry));
}

module.exports = {
  emitLogRecord,
  forceFlushOpenTelemetry,
  waitForOpenTelemetry,
};
