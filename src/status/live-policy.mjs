import { getStrategyCaps, validateStrategyCapsConfig } from "../config/strategy-caps.mjs";

const TRANSPORT_ONLY_AUDIT_BLOCKERS = new Set([
  "candidate amount diversity",
]);

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function primaryCandidate(reviewPackage = null) {
  return reviewPackage?.primaryLiveCandidate || reviewPackage || null;
}

function transportOnlyAudit(audit = null) {
  if (audit?.decision === "LIVE_CANARY_REVIEW_POSSIBLE") return true;
  const blockers = Array.isArray(audit?.blockers) ? audit.blockers : [];
  if (!blockers.length) return false;
  return blockers.every((blocker) => TRANSPORT_ONLY_AUDIT_BLOCKERS.has(blocker));
}

function strategyPolicy(candidate = null) {
  if (candidate?.candidateType !== "strategy") {
    return {
      ok: false,
      blockers: ["primary_candidate_not_strategy"],
      strategyId: candidate?.candidateId || null,
    };
  }
  const strategyId = candidate.candidateId || null;
  const caps = getStrategyCaps(strategyId);
  if (!caps) {
    return {
      ok: false,
      blockers: ["strategy_caps_missing"],
      strategyId,
    };
  }
  const validation = validateStrategyCapsConfig(caps);
  const blockers = unique([
    caps.autoExecute === true ? null : "strategy_auto_execute_disabled",
    ...(validation.ok ? [] : validation.errors.map((error) => `strategy_caps_invalid:${error}`)),
  ]);
  return {
    ok: blockers.length === 0,
    blockers,
    strategyId,
    autoExecute: caps.autoExecute === true,
    capValidation: validation,
    caps: {
      perTxUsd: caps.caps?.perTxUsd ?? null,
      perDayUsd: caps.caps?.perDayUsd ?? null,
      maxDailyLossUsd: caps.caps?.maxDailyLossUsd ?? null,
    },
  };
}

export function applyLaneAwareLivePolicy({
  overall = null,
  audit = null,
  reviewPackage = null,
  prelive = null,
  liveBaseline = null,
} = {}) {
  const candidate = primaryCandidate(reviewPackage);
  const policy = strategyPolicy(candidate);
  const baselineClear = (liveBaseline?.counts?.total ?? 0) === 0;
  const preliveReady = prelive?.currentStage === "tiny_live_canary_review";
  const auditTransportOnly = transportOnlyAudit(audit);
  const existingBlockers = overall?.blockers || [];
  const canSuppressAudit =
    existingBlockers.includes("audit_blocks_live") &&
    auditTransportOnly &&
    preliveReady &&
    baselineClear &&
    policy.ok;
  const blockers = canSuppressAudit
    ? existingBlockers.filter((blocker) => blocker !== "audit_blocks_live")
    : existingBlockers;
  const warnings = unique([
    ...(overall?.warnings || []),
    canSuppressAudit ? "transport_audit_warning_only" : null,
    ...(!policy.ok && candidate?.candidateType === "strategy" ? policy.blockers : []),
  ]);

  return {
    ...(overall || {}),
    severity: blockers.length > 0 ? "blocked" : "review",
    liveTrading: blockers.length > 0 ? "BLOCKED" : "ALLOWED",
    blockers,
    warnings,
    lanePolicy: {
      candidateType: candidate?.candidateType || null,
      candidateId: candidate?.candidateId || null,
      preliveReady,
      baselineClear,
      auditTransportOnly,
      auditSuppressedForStrategy: canSuppressAudit,
      strategyPolicy: policy,
    },
  };
}
