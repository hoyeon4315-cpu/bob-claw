import { readFile } from "node:fs/promises";
import { writeTextIfChanged } from "../../lib/file-write.mjs";

function nowMs(now = new Date()) {
  const ms = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

function cfg(config = {}) {
  return {
    failureThreshold: Number.isFinite(config.failureThreshold) ? config.failureThreshold : 5,
    halfOpenAfterMs: Number.isFinite(config.halfOpenAfterMs) ? config.halfOpenAfterMs : 300_000,
  };
}

function depState(state, dep) {
  return state?.[dep] || { state: "closed", failures: 0, openedAt: null, updatedAt: null };
}

export function circuitAllowsDependency(state = {}, dep, { config = {}, now = new Date() } = {}) {
  if (!dep) return { allowed: true, state: "closed", entry: null };
  const entry = depState(state, dep);
  const parsed = cfg(config);
  if (entry.state === "open") {
    const openedMs = nowMs(entry.openedAt || 0);
    if (nowMs(now) - openedMs >= parsed.halfOpenAfterMs) {
      return { allowed: true, state: "half_open", entry: { ...entry, state: "half_open" } };
    }
    return { allowed: false, state: "open", entry };
  }
  return { allowed: true, state: entry.state || "closed", entry };
}

export function recordCircuitFailure(state = {}, dep, { config = {}, now = new Date() } = {}) {
  if (!dep) return { state, entry: null };
  const parsed = cfg(config);
  const current = depState(state, dep);
  const failures = (current.failures || 0) + 1;
  const opened = failures >= parsed.failureThreshold || current.state === "half_open";
  const entry = {
    state: opened ? "open" : "closed",
    failures,
    openedAt: opened ? new Date(nowMs(now)).toISOString() : current.openedAt || null,
    updatedAt: new Date(nowMs(now)).toISOString(),
  };
  return { state: { ...state, [dep]: entry }, entry };
}

export function recordCircuitSuccess(state = {}, dep, { now = new Date() } = {}) {
  if (!dep) return { state, entry: null };
  const entry = {
    state: "closed",
    failures: 0,
    openedAt: null,
    updatedAt: new Date(nowMs(now)).toISOString(),
  };
  return { state: { ...state, [dep]: entry }, entry };
}

export async function readCircuitState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export async function writeCircuitState(path, state) {
  return writeTextIfChanged(path, `${JSON.stringify(state || {}, null, 2)}\n`);
}
