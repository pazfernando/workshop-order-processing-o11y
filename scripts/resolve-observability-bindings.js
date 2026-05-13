#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function readRequiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value.trim();
}

function pick(obj, paths, fallback = "") {
  for (const targetPath of paths) {
    const value = targetPath.split(".").reduce((accumulator, segment) => {
      if (accumulator && Object.prototype.hasOwnProperty.call(accumulator, segment)) {
        return accumulator[segment];
      }

      return undefined;
    }, obj);

    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return fallback;
}

function pickBoolean(obj, paths, fallback = "false") {
  const picked = pick(obj, paths, "");
  if (!picked) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(picked).trim().toLowerCase()) ? "true" : "false";
}

function appendFileLine(filePath, line) {
  fs.appendFileSync(filePath, `${line}\n`);
}

function resolveBindings(payload) {
  const result = payload || {};

  const resolved = {
    OBSERVABILITY_BINDINGS_SOURCE: "workflow_call",
    OBSERVABILITY_BINDINGS_AVAILABLE: "true",
    OBSERVABILITY_INSTRUMENTATION_MODE: pick(result, ["instrumentation.mode"]),
    OBSERVABILITY_EXPORT_STRATEGY: pick(result, ["instrumentation.exportStrategy"]),
    OBSERVABILITY_OTLP_AUTHENTICATION_MODE: pick(result, ["instrumentation.otlpAuthenticationMode"]),
    OBSERVABILITY_OTLP_BASE_ENDPOINT: pick(result, ["outputs.otlpBaseEndpoint"]),
    OBSERVABILITY_OTLP_TRACES_ENDPOINT: pick(result, ["outputs.otlpTracesEndpoint"]),
    OBSERVABILITY_OTLP_METRICS_ENDPOINT: pick(result, ["outputs.otlpMetricsEndpoint"]),
    OBSERVABILITY_LAMBDA_EXEC_WRAPPER: pick(result, ["outputs.lambdaExecWrapper"]),
    OBSERVABILITY_ADOT_LAMBDA_LAYER_ARN: pick(result, ["outputs.adotLambdaLayerArn"]),
    OBSERVABILITY_EMF_COMPATIBILITY_MODE: pickBoolean(result, ["instrumentation.emfCompatibilityMode"], "false"),
  };

  if (!resolved.OBSERVABILITY_INSTRUMENTATION_MODE) {
    throw new Error("Bindings JSON does not include instrumentation.mode.");
  }

  if (!resolved.OBSERVABILITY_EXPORT_STRATEGY) {
    throw new Error("Bindings JSON does not include instrumentation.exportStrategy.");
  }

  return resolved;
}

function main() {
  const sourcePath = path.resolve(readRequiredEnv("OBSERVABILITY_BINDINGS_PATH"));
  const terraformVarsPath = path.resolve(
    process.env.OBSERVABILITY_TERRAFORM_VARS_PATH || "build/observability/terraform.tfvars.json"
  );
  const githubEnvPath = process.env.GITHUB_ENV || "";
  const githubOutputPath = process.env.GITHUB_OUTPUT || "";
  const payload = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const resolved = resolveBindings(payload);

  if (githubEnvPath) {
    for (const [key, value] of Object.entries(resolved)) {
      appendFileLine(githubEnvPath, `${key}=${value}`);
    }
  }

  if (githubOutputPath) {
    appendFileLine(githubOutputPath, `instrumentation_mode=${resolved.OBSERVABILITY_INSTRUMENTATION_MODE}`);
    appendFileLine(githubOutputPath, `export_strategy=${resolved.OBSERVABILITY_EXPORT_STRATEGY}`);
    appendFileLine(githubOutputPath, `otlp_authentication_mode=${resolved.OBSERVABILITY_OTLP_AUTHENTICATION_MODE}`);
  }

  fs.mkdirSync(path.dirname(terraformVarsPath), { recursive: true });
  fs.writeFileSync(
    terraformVarsPath,
    JSON.stringify(
      {
        otel_bindings_json: JSON.stringify(payload),
      },
      null,
      2
    )
  );

  process.stdout.write(`Resolved observability bindings from ${sourcePath} into ${terraformVarsPath}\n`);
}

main();
