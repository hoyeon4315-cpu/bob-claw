import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { evaluateApprovalHygiene } from "./approval-hygiene.mjs";
import { evaluateCapCheck } from "./cap-check.mjs";
import { evaluateConcentrationGuard } from "../risk/concentration-guard.mjs";
import { evaluateConsecutiveFailures } from "./consecutive-failures.mjs";
import { evaluateEvGate } from "./ev-gate.mjs";
import { checkGatewayAvailability } from "./gateway-availability.mjs";
import { evaluateHealthFactorCheck } from "./hf-check.mjs";
import { evaluateLiquidityWatch } from "../risk/liquidity-watch.mjs";
import { evaluateTinyLiveCanaryPolicy } from "./tiny-live-canary-policy.mjs";
import { checkKillSwitch } from "./kill-switch.mjs";
import { evaluateStaleQuote } from "./stale-quote.mjs";

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function buildConcentrationCandidate(intent, totalOperatingCapitalUsd) {
  if (!isFiniteNumber(totalOperatingCapitalUsd) || totalOperatingCapitalUsd <= 0) return null;
  const addShare = isFiniteNumber(intent.amountUsd) ? intent.amountUsd / totalOperatingCapitalUsd : null;
  if (!isFiniteNumber(addShare)) return null;
  const protocolIds = Array.isArray(intent.metadata?.protocolIds)
    ? intent.metadata.protocolIds
    : intent.metadata?.protocol
      ? [String(intent.metadata.protocol)]
      : [];
  return {
    strategyId: intent.strategyId,
    chainId: intent.chain,
    addShare,
    protocolIds,
  };
}

function mapLiquidityBlockers(verdict) {
  if (verdict.ok) return [];
  const blockers = [];
  const hasWithdrawalQueue = verdict.violations.some((v) => v.kind === "withdrawal_queue_too_deep");
  const hasUtilization = verdict.violations.some((v) => v.kind === "utilization_sustained_over_threshold");
  if (hasWithdrawalQueue) blockers.push("liquidity_queue_unwind");
  if (hasUtilization) blockers.push("liquidity_pause_new_entries");
  if (blockers.length === 0) blockers.push("liquidity_watch_breach");
  return blockers;
}

function mapConcentrationBlockers(verdict) {
  if (verdict.ok) return [];
  return ["concentration_guard_reject_intent"];
}

export async function evaluateIntentPolicies({
  intent,
  auditRecords = [],
  receiptRecords = [],
  activeBudgetUsd = null,
  now = new Date().toISOString(),
  killSwitchPath,
  riskContext = null,
  evCostModel = null,
} = {}) {
  const strategyCaps = assertStrategyCaps(intent.strategyId);

  const liquiditySnapshot = riskContext?.liquiditySnapshot || intent.metadata?.liquiditySnapshot || null;
  const liquidityVerdict = liquiditySnapshot
    ? evaluateLiquidityWatch(liquiditySnapshot, riskContext?.liquidityThresholds ?? undefined)
    : null;

  const concentrationCandidate = buildConcentrationCandidate(intent, riskContext?.totalOperatingCapitalUsd ?? activeBudgetUsd);
  const concentrationVerdict = concentrationCandidate
    ? evaluateConcentrationGuard({
        currentAllocations: riskContext?.currentAllocations || intent.metadata?.currentAllocations || {},
        candidate: concentrationCandidate,
        policy: riskContext?.diversificationPolicy ?? undefined,
      })
    : null;

  const results = [
    await checkKillSwitch({ killSwitchPath, now }),
    await checkGatewayAvailability({
      intent,
      availability: riskContext?.gatewayAvailability || intent.metadata?.gatewayAvailability || null,
      now,
    }),
    evaluateEvGate({
      intent,
      receiptHistory: evCostModel || { receiptRecords, auditRecords },
      now,
      policy: riskContext?.evCostPolicy || undefined,
    }),
    evaluateConsecutiveFailures({
      intent,
      auditRecords,
      resumeAfter: strategyCaps.resumeAfterFailureAt || null,
      maxConsecutiveFailures: strategyCaps.maxConsecutiveFailures ?? undefined,
      now,
    }),
    evaluateCapCheck({ intent, strategyCaps, auditRecords, activeBudgetUsd, now }),
    evaluateHealthFactorCheck({ intent, strategyCaps, now }),
    evaluateStaleQuote({ intent, maxAgeMs: strategyCaps.intentTtlMs ?? undefined, now }),
    evaluateApprovalHygiene({ intent, now }),
    evaluateTinyLiveCanaryPolicy({
      intent,
      strategyCaps,
      microCanaryStatus: riskContext?.microCanaryStatus || intent.metadata?.microCanaryStatus || null,
      auditRecords,
      now,
    }),
    liquidityVerdict
      ? {
          policy: "liquidity_watch",
          observedAt: now,
          decision: liquidityVerdict.ok ? "ALLOW" : "BLOCK",
          blockers: mapLiquidityBlockers(liquidityVerdict),
          verdict: liquidityVerdict,
        }
      : null,
    concentrationVerdict
      ? {
          policy: "concentration_guard",
          observedAt: now,
          decision: concentrationVerdict.ok ? "ALLOW" : "BLOCK",
          blockers: mapConcentrationBlockers(concentrationVerdict),
          verdict: concentrationVerdict,
        }
      : null,
  ].filter(Boolean);

  const blockers = results.flatMap((item) => item.blockers || []);
  const hfResult = results.find((r) => r.policy === "hf_check");
  const requiresUnwind = hfResult?.requiresUnwind === true;
  const emergencyUnwindPath = hfResult?.emergencyUnwindPath || null;
  return {
    observedAt: now,
    strategyId: intent.strategyId,
    decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
    blockers: [...new Set(blockers)],
    results,
    strategyCaps,
    requiresUnwind,
    emergencyUnwindPath,
  };
}
