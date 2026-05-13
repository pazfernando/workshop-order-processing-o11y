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

function readOptionalEnv(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJsonObject(value, label) {
  if (!value || !value.trim()) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Unable to parse ${label} as JSON: ${error.message}`);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${label} must be a JSON object.`);
  }

  return parsed;
}

function buildUrl(baseUrl, apiPath) {
  return new URL(apiPath.replace(/^\//, ""), `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

function headersToObject(headers) {
  const result = {};
  for (const [key, value] of headers.entries()) {
    result[key] = value;
  }

  return result;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `IDP response from ${response.url} is not valid JSON (status ${response.status}): ${error.message}\n${text}`
    );
  }
}

function extractStatusUrl(body) {
  if (typeof body?.statusUrl === "string" && body.statusUrl) {
    return body.statusUrl;
  }

  if (typeof body?.links?.status === "string" && body.links.status) {
    return body.links.status;
  }

  return "";
}

function isTerminalReady(body) {
  const phase = String(body?.phase || body?.status || "").toLowerCase();
  return ["ready", "completed", "succeeded", "success", "bound"].includes(phase);
}

function isTerminalFailure(body) {
  const phase = String(body?.phase || body?.status || "").toLowerCase();
  return ["failed", "error", "rejected", "cancelled"].includes(phase);
}

async function callIdp(url, init) {
  const response = await fetch(url, init);
  const body = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      `IDP request failed with status ${response.status} ${response.statusText}: ${JSON.stringify(body, null, 2)}`
    );
  }

  return { response, body };
}

async function pollStatus(statusUrl, token, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const headers = {
      Accept: "application/json",
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const { body } = await callIdp(statusUrl, {
      method: "GET",
      headers,
    });

    if (isTerminalReady(body)) {
      return body;
    }

    if (isTerminalFailure(body)) {
      throw new Error(`IDP provisioning finished in failure state: ${JSON.stringify(body, null, 2)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error(`Timed out waiting for IDP provisioning after ${timeoutSeconds} seconds.`);
}

async function main() {
  const contractPath = readRequiredEnv("OBSERVABILITY_CONTRACT_PATH");
  const apiBaseUrl = readRequiredEnv("IDP_API_BASE_URL");
  const apiPath = readOptionalEnv("IDP_API_PATH", "/v1/observability/provision");
  const responsePath = readRequiredEnv("OBSERVABILITY_IDP_RESPONSE_PATH");
  const waitForReady = parseBoolean(process.env.IDP_WAIT_FOR_READY, true);
  const timeoutSeconds = parseInteger(process.env.IDP_TIMEOUT_SECONDS, 600);
  const token = readOptionalEnv("OBSERVABILITY_IDP_TOKEN");
  const requestOverrides = parseJsonObject(process.env.IDP_REQUEST_OVERRIDES_JSON, "IDP_REQUEST_OVERRIDES_JSON");

  const absoluteContractPath = path.resolve(contractPath);
  const contractContent = fs.readFileSync(absoluteContractPath, "utf8");

  const requestBody = {
    contract: {
      path: contractPath,
      content: contractContent,
    },
    context: {
      tenant: readOptionalEnv("IDP_TENANT"),
      environment: readOptionalEnv("IDP_ENVIRONMENT"),
      capabilityProfile: readOptionalEnv("IDP_CAPABILITY_PROFILE"),
      awsRegion: readOptionalEnv("AWS_REGION"),
      resourcePrefix: readOptionalEnv("RESOURCE_PREFIX"),
      repository: readOptionalEnv("GITHUB_REPOSITORY"),
      refName: readOptionalEnv("GITHUB_REF_NAME"),
      commitSha: readOptionalEnv("GITHUB_SHA"),
      runId: readOptionalEnv("GITHUB_RUN_ID"),
    },
    overrides: requestOverrides,
  };

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const requestUrl = buildUrl(apiBaseUrl, apiPath);
  const { response, body } = await callIdp(requestUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  let finalBody = body;
  const statusUrl = extractStatusUrl(body);
  if (!isTerminalReady(body) && !isTerminalFailure(body) && waitForReady && statusUrl) {
    finalBody = await pollStatus(statusUrl, token, timeoutSeconds);
  }

  fs.mkdirSync(path.dirname(responsePath), { recursive: true });
  fs.writeFileSync(
    responsePath,
    JSON.stringify(
      {
        request: {
          url: requestUrl,
          headers: headersToObject(new Headers(headers)),
        },
        initialHttpStatus: response.status,
        result: finalBody,
      },
      null,
      2
    )
  );

  if (!isTerminalReady(finalBody)) {
    throw new Error(
      "IDP response did not reach a ready state and no usable bindings were produced. " +
        `Stored payload at ${responsePath}.`
    );
  }

  process.stdout.write(`Stored IDP observability response at ${responsePath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
