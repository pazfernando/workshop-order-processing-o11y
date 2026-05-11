#!/usr/bin/env node

const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

async function main() {
  if (process.argv[2] === "code-child") {
    await runCodeChild();
    return;
  }

  if (process.argv[2] === "adot-child") {
    runAdotChild();
    return;
  }

  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({
        method: req.method,
        url: req.url,
        bodyLength: Buffer.concat(chunks).length,
      });
      res.writeHead(200);
      res.end();
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const codeOutput = await runChild("code-child", {
      OBSERVABILITY_OTEL_ENABLED: "true",
      OTEL_SERVICE_NAME: "otel-local-test",
      SERVICE_NAME: "otel-local-test",
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
      OTEL_TRACES_EXPORTER: "otlp",
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
      OTEL_METRIC_EXPORT_INTERVAL_MS: "50",
    });

    const sawMetricsRequest = requests.some((request) => request.url === "/v1/metrics" && request.bodyLength > 0);
    if (!sawMetricsRequest) {
      throw new Error(`Expected at least one OTLP metrics request to /v1/metrics. Requests seen: ${JSON.stringify(requests)}`);
    }

    if (!codeOutput.includes("OpenTelemetry SDK started")) {
      throw new Error(`Expected code path to log SDK start. Output: ${codeOutput}`);
    }

    const adotOutput = await runChild("adot-child", {
      OBSERVABILITY_OTEL_ENABLED: "true",
      OTEL_SERVICE_NAME: "otel-local-test",
      SERVICE_NAME: "otel-local-test",
      AWS_LAMBDA_EXEC_WRAPPER: "/opt/otel-handler",
    });

    if (!adotOutput.includes("adot-lambda-layer-wrapper-active")) {
      throw new Error(`Expected ADOT path to log wrapper skip. Output: ${adotOutput}`);
    }

    console.log("OTel local runtime test passed.");
  } finally {
    server.close();
  }
}

async function runCodeChild() {
  const bootstrapPath = path.resolve(__dirname, "../src/shared/otel-bootstrap");
  const observabilityPath = path.resolve(__dirname, "../src/shared/observability");

  require(bootstrapPath);
  const { emitMetric, waitForOpenTelemetry, forceFlushOpenTelemetry } = require(observabilityPath);

  await waitForOpenTelemetry();
  emitMetric("LocalOtelMetric", 1, {
    service: "otel-local-test",
    operation: "test",
  });
  await forceFlushOpenTelemetry();
  await sleep(200);
}

function runAdotChild() {
  const bootstrapPath = path.resolve(__dirname, "../src/shared/otel-bootstrap");
  require(bootstrapPath);
}

function runChild(mode, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, mode], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve(`${stdout}\n${stderr}`);
        return;
      }

      reject(new Error(`Child mode ${mode} failed with code ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
