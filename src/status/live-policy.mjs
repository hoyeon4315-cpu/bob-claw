import { getStrategyCaps, validateStrategyCapsConfig } from "../config/strategy-caps.mjs";

const TRANSPORT_ONLY_AUDIT_BLOCKERS = new Set([
  "candidate amount diversity",
]);

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function runtimeBlockerCodes(executorRuntime = null) {
  const killSwitch = executorRuntime?.killSwitch || null;
  if (!killSwitch?.halted) return [];
  return unique([
    "kill_switch_present",
    killSwitch?.replay?.staleArm ? "kill_switch_stale_arm_present" : null,
  ]);
}

function baselineBlockerCodes(liveBaseline = null) {
  return unique(
    ["refresh", "operator", "technical", "objective"].flatMap((category) =>
      (liveBaseline?.blockers?.[category] || []).map((blocker) => blocker?.code || null),
    ),
  );
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
      perChainUsd: caps.caps?.perChainUsd ?? null,
      maxDailyLossUsd: caps.caps?.maxDailyLossUsd ?? null,
    },
    exposure: caps.exposure
      ? {
          protocols: caps.exposure.protocols || [],
          assetFamily: caps.exposure.assetFamily || null,
          btcDenominated: caps.exposure.btcDenominated ?? null,
        }
      : null,
    leverage: caps.leverage
      ? {
          healthFactorMin: caps.leverage.healthFactorMin ?? null,
          liquidationBufferPct: caps.leverage.liquidationBufferPct ?? null,
          emergencyUnwindPath: caps.leverage.emergencyUnwindPath || [],
        }
      : null,
  };
}

export function applyLaneAwareLivePolicy({
  overall = null,
  audit = null,
  reviewPackage = null,
  prelive = null,
  liveBaseline = null,
  edgeViability = null,
  stageEvaluation = null,
  executorRuntime = null,
} = {}) {
  const candidate = primaryCandidate(reviewPackage);
  const policy = strategyPolicy(candidate);
  const baselineClear = (liveBaseline?.counts?.total ?? 0) === 0;
  const baselineCodes = baselineBlockerCodes(liveBaseline);
  const preliveReady = prelive?.currentStage === "tiny_live_canary_review";
  const auditTransportOnly = transportOnlyAudit(audit);
  const existingBlockers = overall?.blockers || [];
  const canSuppressAudit =
    existingBlockers.includes("audit_blocks_live") &&
    auditTransportOnly &&
    preliveReady &&
    policy.ok;
  let blockers = unique([
    ...(canSuppressAudit ? existingBlockers.filter((blocker) => blocker !== "audit_blocks_live") : existingBlockers),
    ...baselineCodes,
  ]);
  const warnings = unique([
    ...(overall?.warnings || []),
    canSuppressAudit ? "transport_audit_warning_only" : null,
    ...(!policy.ok && candidate?.candidateType === "strategy" ? policy.blockers : []),
  ]);

  const hasPolicyReadyEdge = edgeViability?.verdict?.code === "policy_ready";
  let liveTrading = blockers.length > 0 ? "BLOCKED" : "ALLOWED";
  if (hasPolicyReadyEdge && liveTrading === "BLOCKED" && policy.ok) {
    liveTrading = "ALLOWED";
    warnings.push(...blockers.map((b) => `promoted_from_blocker:${b}`));
    blockers = [];
  }
  const preStageLiveTrading = liveTrading;
  const stage = stageEvaluation?.currentStage || null;
  const stageBlockers = stage && stage !== "C" ? unique(stageEvaluation?.blockers || []) : [];
  const runtimeBlockers = runtimeBlockerCodes(executorRuntime);
  if (stage && stage !== "C") {
    liveTrading = "BLOCKED";
  }
  if (runtimeBlockers.length > 0) {
    liveTrading = "BLOCKED";
  }
  blockers = unique([
    ...blockers,
    ...stageBlockers,
    ...runtimeBlockers,
  ]);

  return {
    ...(overall || {}),
    severity: blockers.length > 0 ? "blocked" : "review",
    liveTrading,
    blockers,
    warnings: unique([
      ...warnings,
      stage === "A" ? "lane_stage_A_locked" : null,
      stage === "B" ? "lane_stage_B_shadow_only" : null,
    ]),
    lanePolicy: {
      candidateType: candidate?.candidateType || null,
      candidateId: candidate?.candidateId || null,
      preliveReady,
      baselineClear,
      auditTransportOnly,
      auditSuppressedForStrategy: canSuppressAudit,
      strategyPolicy: policy,
      edgeViabilityCode: edgeViability?.verdict?.code || null,
      preStageLiveTrading,
      stage,
      stageBlockers,
      stageEvidence: stageEvaluation?.evidence || null,
      runtimeBlockers,
      runtimeEvidence: executorRuntime?.killSwitch
        ? {
            halted: executorRuntime.killSwitch.halted === true,
            activeReason: executorRuntime.killSwitch.activeReason || null,
            staleArm: executorRuntime.killSwitch.replay?.staleArm === true,
          }
        : null,
    },
  };
}
