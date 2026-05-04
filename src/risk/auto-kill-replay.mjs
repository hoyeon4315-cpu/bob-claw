import { buildAutoKillConfig } from "../config/auto-kill.mjs";
import { evaluateAutoKillTriggers } from "./auto-kill-triggers.mjs";

export function heartbeatTimestampMs(payload = null) {
  if (!payload || typeof payload !== "object") return null;
  const directRaw = payload.observedAtMs;
  if (typeof directRaw === "number" && Number.isFinite(directRaw)) return directRaw;
  if (typeof directRaw === "string" && directRaw.trim() !== "") {
    const direct = Number(directRaw);
    if (Number.isFinite(direct)) return direct;
  }
  const timestamp = payload.observedAt || payload.updatedAt || null;
  if (!timestamp) return null;
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildClStatusFromAnchorHealth(payload) {
  if (!payload || !Array.isArray(payload.positions)) return {};
  let sum = 0;
  let count = 0;
  let ilExceedsFeesHours = null;
  for (const pos of payload.positions) {
    const rawTimeInRange =
      typeof pos.timeInRange === "string"
        ? pos.timeInRange.replace("%", "")
        : pos.timeInRange;
    const value = Number(rawTimeInRange);
    if (Number.isFinite(value)) {
      sum += value > 1 ? value / 100 : value;
      count += 1;
    }
    const rawIlHours = Number(pos.ilExceedsFeesHours ?? pos.health?.ilExceedsFeesHours);
    if (Number.isFinite(rawIlHours)) {
      ilExceedsFeesHours = Math.max(ilExceedsFeesHours ?? 0, rawIlHours);
    }
  }
  const timeInRangePct24h = count > 0 ? sum / count : null;
  return { timeInRangePct24h, ilExceedsFeesHours };
}

export function deriveActiveProtocols(activeProtocolsPayload = null, anchorHealthPayload = null) {
  if (Array.isArray(activeProtocolsPayload)) return activeProtocolsPayload;
  if (Array.isArray(activeProtocolsPayload?.protocols)) return activeProtocolsPayload.protocols;
  if (anchorHealthPayload?.positions?.length > 0) return ["aerodrome"];
  return [];
}

export function normalizePriceSamples(priceSamplesPayload = null) {
  if (Array.isArray(priceSamplesPayload)) return priceSamplesPayload;
  if (Array.isArray(priceSamplesPayload?.samples)) return priceSamplesPayload.samples;
  return [];
}

export function normalizeOracleSamples(oraclePayload = null) {
  return Array.isArray(oraclePayload?.samples) ? oraclePayload.samples : [];
}

function parseActiveTriggerNames(activeReason = null) {
  if (typeof activeReason !== "string" || !activeReason.startsWith("auto_kill:")) return [];
  return activeReason
    .slice("auto_kill:".length)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildAutoKillReplayStatus({
  auditRecords = [],
  executorRuntime = null,
  oraclePayload = null,
  priceSamplesPayload = null,
  anchorHealthPayload = null,
  activeProtocolsPayload = null,
  campaignStatusPayload = null,
  operatingCapitalUsd = null,
  now = new Date(),
  config = buildAutoKillConfig(),
} = {}) {
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const heartbeatAtMs = heartbeatTimestampMs({
    observedAt: executorRuntime?.observedAt || null,
  });
  const oracleSamples = normalizeOracleSamples(oraclePayload);
  const priceSamples = normalizePriceSamples(priceSamplesPayload);
  const clStatus = buildClStatusFromAnchorHealth(anchorHealthPayload);
  const activeProtocols = deriveActiveProtocols(activeProtocolsPayload, anchorHealthPayload);
  const campaignStatus = campaignStatusPayload || {};
  const verdict = evaluateAutoKillTriggers({
    auditRecords,
    oracleSamples,
    heartbeatAtMs,
    operatingCapitalUsd,
    priceSamples,
    clStatus,
    activeProtocols,
    campaignStatus,
    config,
    now: effectiveNow,
  });
  const triggerNames = verdict.triggers.map((trigger) => trigger.trigger);
  const activeReason = executorRuntime?.killSwitch?.activeReason || null;
  const activeTriggerNames = parseActiveTriggerNames(activeReason);
  const armed = executorRuntime?.killSwitch?.halted === true;
  const matchingActiveTrigger =
    activeTriggerNames.length > 0 &&
    activeTriggerNames.every((name) => triggerNames.includes(name));

  return {
    evaluatedAt: verdict.evaluatedAt,
    triggered: verdict.triggered,
    triggerNames,
    triggers: verdict.triggers,
    armed,
    staleArm: armed && !verdict.triggered,
    activeReason,
    activeTriggerNames,
    matchingActiveTrigger,
    heartbeatAt: executorRuntime?.observedAt || null,
    inputCounts: {
      auditRecordCount: auditRecords.length,
      oracleSampleCount: oracleSamples.length,
      priceSampleCount: priceSamples.length,
      activeProtocolCount: activeProtocols.length,
    },
    clStatus,
  };
}
