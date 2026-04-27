import { rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

export const REPORTING_PNL_BASELINE_FILE = "reporting-pnl-baseline.json";

function normalizeTimestamp(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function summarizeReportingPnlBaseline(baseline = null, { now = new Date().toISOString(), applied = true } = {}) {
  const anchoredAt = baseline?.anchoredAt || null;
  const anchoredAtMs = normalizeTimestamp(anchoredAt);
  return {
    active: Number.isFinite(anchoredAtMs),
    applied: Boolean(applied && Number.isFinite(anchoredAtMs)),
    anchoredAt,
    reason: baseline?.reason || null,
    updatedAt: baseline?.updatedAt || null,
  };
}

export function normalizeReportingPnlBaselineRecord(record = null) {
  const anchoredAtMs = normalizeTimestamp(record?.anchoredAt);
  if (!Number.isFinite(anchoredAtMs)) return null;
  return {
    schemaVersion: 1,
    anchoredAt: new Date(anchoredAtMs).toISOString(),
    anchoredAtMs,
    reason: record?.reason || null,
    updatedAt: record?.updatedAt || null,
  };
}

export function filterRecordsByReportingPnlBaseline(
  records = [],
  baseline = null,
  { pickTimestamp = (item) => item?.observedAt || item?.timestamp || item?.settledAt || null } = {},
) {
  if (!Array.isArray(records)) return [];
  const anchoredAtMs = baseline?.anchoredAtMs ?? normalizeTimestamp(baseline?.anchoredAt);
  if (!Number.isFinite(anchoredAtMs)) return [...records];
  return records.filter((item) => {
    const observedAtMs = normalizeTimestamp(pickTimestamp(item));
    return Number.isFinite(observedAtMs) ? observedAtMs >= anchoredAtMs : true;
  });
}

export async function readReportingPnlBaseline({
  dataDir = config.dataDir,
  fileName = REPORTING_PNL_BASELINE_FILE,
} = {}) {
  const record = await readJsonIfExists(join(dataDir, fileName));
  return normalizeReportingPnlBaselineRecord(record);
}

export async function setReportingPnlBaseline({
  dataDir = config.dataDir,
  fileName = REPORTING_PNL_BASELINE_FILE,
  anchoredAt = new Date().toISOString(),
  reason = "manual_reporting_reset",
} = {}) {
  const anchoredAtMs = normalizeTimestamp(anchoredAt);
  if (!Number.isFinite(anchoredAtMs)) {
    throw new Error("anchoredAt must be a valid ISO timestamp");
  }
  const normalized = {
    schemaVersion: 1,
    anchoredAt: new Date(anchoredAtMs).toISOString(),
    reason,
    updatedAt: new Date().toISOString(),
  };
  const result = await writeTextIfChanged(
    join(dataDir, fileName),
    `${JSON.stringify(normalized, null, 2)}\n`,
  );
  return {
    ...result,
    baseline: normalizeReportingPnlBaselineRecord(normalized),
  };
}

export async function clearReportingPnlBaseline({
  dataDir = config.dataDir,
  fileName = REPORTING_PNL_BASELINE_FILE,
} = {}) {
  const path = join(dataDir, fileName);
  try {
    await rm(path);
    return { path, cleared: true };
  } catch (error) {
    if (error.code === "ENOENT") return { path, cleared: false };
    throw error;
  }
}
