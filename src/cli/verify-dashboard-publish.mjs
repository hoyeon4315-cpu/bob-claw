#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const DASHBOARD_PUBLISH_FILES = Object.freeze([
  "dashboard-status.json",
  "wallet-holdings.json",
  "strategy-tick-status.json",
  "auto-kill-events.json",
  "live-runtime.json",
]);

const GENERATED_AT_ALIASES = Object.freeze({
  "auto-kill-events.json": ["generatedAt", "observedAt"],
  "live-runtime.json": ["generatedAt", "updatedAt"],
});

function parseArgs(argv = []) {
  const entries = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const index = arg.indexOf("=");
        return [arg.slice(2, index), arg.slice(index + 1)];
      }),
  );
  return {
    publicDir: entries["public-dir"] || join("dashboard", "public"),
    now: entries.now || new Date().toISOString(),
  };
}

function isIsoDateTime(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function timestampMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function generatedAtInfo(file, payload = {}) {
  const keys = GENERATED_AT_ALIASES[file] || ["generatedAt"];
  for (const key of keys) {
    if (payload[key] !== undefined) {
      return {
        value: payload[key],
        source: key,
      };
    }
  }
  return {
    value: undefined,
    source: "generatedAt",
  };
}

function schemaVersionInfo(file, payload = {}) {
  if (payload.schemaVersion !== undefined) {
    return {
      value: payload.schemaVersion,
      legacyAccepted: false,
    };
  }
  if (file === "live-runtime.json") {
    return {
      value: 1,
      legacyAccepted: true,
    };
  }
  return {
    value: undefined,
    legacyAccepted: false,
  };
}

async function readDashboardFile(publicDir, file) {
  const path = join(publicDir, file);
  const text = await readFile(path, "utf8");
  return {
    file,
    path,
    payload: JSON.parse(text),
  };
}

export async function verifyDashboardPublish({
  publicDir = join("dashboard", "public"),
  now = new Date().toISOString(),
  files = DASHBOARD_PUBLISH_FILES,
} = {}) {
  const errors = [];
  const warnings = [];
  const nowMs = timestampMs(now);
  if (!Number.isFinite(nowMs)) {
    errors.push({ code: "invalid_now", message: "--now must be an ISO8601 timestamp" });
  }

  const checkedFiles = [];
  for (const file of files) {
    try {
      const { payload } = await readDashboardFile(publicDir, file);
      const schema = schemaVersionInfo(file, payload);
      const generated = generatedAtInfo(file, payload);
      if (schema.value === undefined || schema.value === null) {
        errors.push({ file, code: "missing_schemaVersion", message: "schemaVersion is required" });
      }
      if (schema.legacyAccepted) {
        warnings.push({ file, code: "legacy_schemaVersion_accepted", message: "live-runtime.json predates schemaVersion; treating as schemaVersion=1" });
      }
      if (!isIsoDateTime(generated.value)) {
        errors.push({ file, code: "invalid_generatedAt", message: `${generated.source} must be ISO8601` });
      } else if (generated.source !== "generatedAt") {
        warnings.push({ file, code: "generatedAt_alias_used", message: `${generated.source} accepted as generatedAt compatibility timestamp` });
      }
      checkedFiles.push({
        file,
        schemaVersion: schema.value ?? null,
        generatedAt: generated.value ?? null,
        generatedAtSource: generated.source,
        latestTickAt: payload.latestTickAt || null,
      });
    } catch (error) {
      errors.push({
        file,
        code: error.code === "ENOENT" ? "missing_file" : "invalid_json",
        message: error.message,
      });
    }
  }

  const latestTickCandidates = checkedFiles
    .map((item) => item.latestTickAt)
    .filter(Boolean);
  if (latestTickCandidates.length === 0) {
    errors.push({ code: "missing_latestTickAt", message: "at least one dashboard publish slice must expose latestTickAt" });
  }
  const latestTickAt = latestTickCandidates
    .filter(isIsoDateTime)
    .sort((left, right) => timestampMs(right) - timestampMs(left))[0] || null;
  if (!latestTickAt && latestTickCandidates.length > 0) {
    errors.push({ code: "invalid_latestTickAt", message: "latestTickAt must be ISO8601" });
  }
  const latestTickAgeMs = latestTickAt && Number.isFinite(nowMs) ? nowMs - timestampMs(latestTickAt) : null;
  if (Number.isFinite(latestTickAgeMs) && (latestTickAgeMs < 0 || latestTickAgeMs > 24 * 60 * 60 * 1000)) {
    errors.push({
      code: "stale_latestTickAt",
      message: "latestTickAt must be within the trailing 24h window",
      latestTickAt,
      latestTickAgeMs,
    });
  }

  return {
    ok: errors.length === 0,
    schemaVersion: 1,
    checkedAt: now,
    publicDir,
    files: checkedFiles,
    latestTickAt,
    latestTickAgeMs,
    errors,
    warnings,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await verifyDashboardPublish(args);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
