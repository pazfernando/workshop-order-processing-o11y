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

function pickBoolean(obj, paths, fallback = "") {
  for (const targetPath of paths) {
    const value = targetPath.split(".").reduce((accumulator, segment) => {
      if (accumulator && Object.prototype.hasOwnProperty.call(accumulator, segment)) {
        return accumulator[segment];
      }

      return undefined;
    }, obj);

    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }

    if (typeof value === "string" && value.trim()) {
      return value.trim().toLowerCase() === "true" ? "true" : "false";
    }
  }

  return fallback;
}

function appendFileLine(filePath, line) {
  fs.appendFileSync(filePath, `${line}\n`);
}

function resolveBindings(payload) {
  const result = payload?.result || payload;

  const resolved = {
    OBSERVABILITY_PROVIDER_REF: pick(result, ["providerRef", "provider.ref", "metadata.providerRef"]),
  };

  if (!resolved.OBSERVABILITY_PROVIDER_REF) {
    throw new Error("IDP response does not include an observability provider reference.");
  }

  return resolved;
}

function main() {
  const sourcePath = path.resolve(readRequiredEnv("OBSERVABILITY_IDP_RESPONSE_PATH"));
  const githubEnvPath = readRequiredEnv("GITHUB_ENV");
  const githubOutputPath = process.env.GITHUB_OUTPUT || "";
  const payload = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const resolved = resolveBindings(payload);

  for (const [key, value] of Object.entries(resolved)) {
    appendFileLine(githubEnvPath, `${key}=${value}`);
  }

  appendFileLine(githubEnvPath, "OBSERVABILITY_BINDINGS_SOURCE=idp");

  if (githubOutputPath) {
    appendFileLine(githubOutputPath, `provider_ref=${resolved.OBSERVABILITY_PROVIDER_REF}`);
  }

  process.stdout.write(`Resolved observability bindings from ${sourcePath}\n`);
}

main();
