import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_DATA_DIR = "data";
const FEEDBACK_FILE_NAME = "slippage-feedback.jsonl";

export function featureEnabled(profile = {}) {
  if (typeof profile === "string") return true;
  return profile.slippageFeedback !== false;
}

function buildRouteKey(intent = {}) {
  return `${intent.chain || "unknown"}:${intent.protocol || "unknown"}:${intent.strategyId || "unknown"}`;
}

function readHistory(routeKey, dataDir = DEFAULT_DATA_DIR) {
  const filePath = join(dataDir, FEEDBACK_FILE_NAME);
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return [];
  const lines = raw.split("\n");
  const history = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.routeKey === routeKey) history.push(entry);
    } catch {
      // skip corrupt line
    }
  }
  return history;
}

export function evaluateSlippageFeedback({ intent = {}, realizedSlippageBps = 0, history = [], dataDir = DEFAULT_DATA_DIR } = {}) {
  if (!featureEnabled(intent.profile)) {
    return { adjustedEstimateBps: null, action: "noop" };
  }

  const routeKey = buildRouteKey(intent);
  const effectiveHistory = history.length > 0 ? history : readHistory(routeKey, dataDir);

  const consistentOverruns = effectiveHistory.filter((entry) => {
    const diff = (entry.realizedSlippageBps || 0) - (entry.estimatedSlippageBps || 0);
    return diff > 50;
  });

  const shouldRaise = consistentOverruns.length >= 3;

  const latestEstimate = effectiveHistory.length > 0
    ? effectiveHistory[effectiveHistory.length - 1].estimatedSlippageBps
    : (intent.estimatedSlippageBps || 0);

  const adjustedEstimateBps = shouldRaise ? latestEstimate + 50 : latestEstimate;

  return {
    adjustedEstimateBps,
    action: shouldRaise ? "raise_estimate" : "maintain",
    overrunCount: consistentOverruns.length,
  };
}

export function recordSlippageFeedback({ intent = {}, realizedSlippageBps = 0, estimatedSlippageBps = 0, now = new Date().toISOString(), dataDir = DEFAULT_DATA_DIR } = {}) {
  if (!featureEnabled(intent.profile)) return;
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const filePath = join(dataDir, FEEDBACK_FILE_NAME);
  const routeKey = buildRouteKey(intent);
  const entry = { routeKey, realizedSlippageBps, estimatedSlippageBps, observedAt: now };
  appendFileSync(filePath, JSON.stringify(entry) + "\n");
}
