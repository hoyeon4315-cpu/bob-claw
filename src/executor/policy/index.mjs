import { getStrategyCaps, validateStrategyCapsConfig } from "../../config/strategy-caps.mjs";
import { evaluateApprovalHygiene } from "./approval-hygiene.mjs";
import { evaluateAssetCoverageGuard } from "./asset-coverage-guard.mjs";
import { evaluateCapCheck } from "./cap-check.mjs";
import {
  applyColdStartClampToIntent,
  buildColdStartClampPolicyResult,
  evaluateColdStartClamp,
} from "./cold-start-clamp.mjs";
import { evaluateConcentrationGuard } from "../risk/concentration-guard.mjs";
import { evaluateConsecutiveFailures } from "./consecutive-failures.mjs";
import { evaluateEvGate } from "./ev-gate.mjs";
import { evaluateAutoKillTriggers } from "../../risk/auto-kill-triggers.mjs";
import { evaluateGasBudgetController } from "../../risk/gas-budget-controller.mjs";
import { checkGatewayAvailability } from "./gateway-availability.mjs";
import { evaluateHealthFactorCheck } from "./hf-check.mjs";
import { evaluateLeverageCollateralRule } from "./leverage-collateral-rule.mjs";
import { evaluateLiquidityWatch } from "../risk/liquidity-watch.mjs";
import { evaluateTinyLiveCanaryPolicy } from "./tiny-live-canary-policy.mjs";
import { checkKillSwitch } from "./kill-switch.mjs";
import { evaluateGasPriceCeiling } from "./gas-price-ceiling.mjs";
import { evaluatePreBroadcastSimulation } from "./pre-broadcast-simulator.mjs";
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

function evaluateStrategyCapsPresence({ intent, strategyCaps, now }) {
  if (!strategyCaps) {
    return {
      policy: "strategy_caps",
      observedAt: now,
      decision: "BLOCK",
      blockers: ["strategy_caps_missing"],
      errors: [`Unknown strategy caps for ${intent?.strategyId || "unknown"}`],
    };
  }
  const validation = validateStrategyCapsConfig(strategyCaps);
  return {
    policy: "strategy_caps",
    observedAt: now,
    decision: validation.ok ? "ALLOW" : "BLOCK",
    blockers: validation.ok ? [] : ["strategy_caps_invalid"],
    errors: validation.errors,
  };
}

function evaluateAutoKillPolicy({
  riskContext = null,
  auditRecords = [],
  activeBudgetUsd = null,
  now,
} = {}) {
  const direct = riskContext?.autoKill || riskContext?.autoKillVerdict || riskContext?.autoKillResult || null;
  const inputs = riskContext?.autoKillInputs || null;
  if (!direct && !inputs) return null;

  const verdict = direct || evaluateAutoKillTriggers({
    auditRecords: inputs.auditRecords || auditRecords,
    oracleSamples: inputs.oracleSamples || [],
    heartbeatAtMs: inputs.heartbeatAtMs ?? null,
    operatingCapitalUsd: inputs.operatingCapitalUsd ?? riskContext?.operatingCapitalUsd ?? activeBudgetUsd,
    priceSamples: inputs.priceSamples || [],
    clStatus: inputs.clStatus || {},
    activeProtocols: inputs.activeProtocols || [],
    campaignStatus: inputs.campaignStatus || {},
    config: inputs.config,
    now: new Date(now),
  });
  const triggered = verdict?.triggered === true || verdict?.killSwitchActive === true || verdict?.alreadyArmed === true;
  return {
    policy: "auto_kill_triggers",
    observedAt: now,
    decision: triggered ? "BLOCK" : "ALLOW",
    blockers: triggered ? ["auto_kill_triggered"] : [],
    triggers: Array.isArray(verdict?.triggers) ? verdict.triggers : [],
    verdict,
  };
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
  const strategyCaps = intent?.strategyId ? getStrategyCaps(intent.strategyId) : null;
  const strategyCapsResult = evaluateStrategyCapsPresence({ intent, strategyCaps, now });
  if (strategyCapsResult.decision === "BLOCK") {
    return {
      observedAt: now,
      strategyId: intent?.strategyId || null,
      decision: "BLOCK",
      blockers: strategyCapsResult.blockers,
      results: [strategyCapsResult],
      strategyCaps: strategyCaps || null,
      requiresUnwind: false,
      emergencyUnwindPath: null,
    };
  }

  const strategyForPolicy = {
    ...strategyCaps,
    ...(riskContext?.strategy || {}),
  };
  const amountClamp = evaluateColdStartClamp({
    strategy: strategyForPolicy,
    signerAuditRecords: auditRecords,
    now,
  });
  const effectiveIntent = applyColdStartClampToIntent(intent, amountClamp);

  const liquiditySnapshot = riskContext?.liquiditySnapshot || effectiveIntent.metadata?.liquiditySnapshot || null;
  const liquidityVerdict = liquiditySnapshot
    ? evaluateLiquidityWatch(liquiditySnapshot, riskContext?.liquidityThresholds ?? undefined)
    : null;

  const concentrationCandidate = buildConcentrationCandidate(effectiveIntent, riskContext?.totalOperatingCapitalUsd ?? activeBudgetUsd);
  const concentrationVerdict = concentrationCandidate
    ? evaluateConcentrationGuard({
        currentAllocations: riskContext?.currentAllocations || effectiveIntent.metadata?.currentAllocations || {},
        candidate: concentrationCandidate,
        policy: riskContext?.diversificationPolicy ?? undefined,
      })
    : null;

  const results = [
    strategyCapsResult,
    buildColdStartClampPolicyResult({ clampResult: amountClamp, originalIntent: intent, effectiveIntent, now }),
    await checkKillSwitch({ killSwitchPath, now }),
    evaluateAutoKillPolicy({ riskContext, auditRecords, activeBudgetUsd, now }),
    await checkGatewayAvailability({
      intent: effectiveIntent,
      availability: riskContext?.gatewayAvailability || effectiveIntent.metadata?.gatewayAvailability || null,
      now,
    }),
    evaluateEvGate({
      intent: effectiveIntent,
      receiptHistory: evCostModel || { receiptRecords, auditRecords },
      now,
      policy: riskContext?.evCostPolicy || undefined,
    }),
    (() => {
      const gasResult = evaluateGasBudgetController({
        intent: effectiveIntent,
        auditRecords,
        positionState: riskContext?.positionState || effectiveIntent.positionState || null,
        gasBaselines: riskContext?.gasBaselines || {},
        dailyGasBudget: riskContext?.broadcastBudgetPolicy || effectiveIntent.metadata?.broadcastBudgetPolicy || undefined,
        operatingCapitalUsd: riskContext?.totalOperatingCapitalUsd ?? activeBudgetUsd ?? null,
        estimatedGasUsd: effectiveIntent.gasEstimateUsd ?? effectiveIntent.metadata?.gasEstimateUsd ?? null,
        now,
      });
      return {
        policy: "gas_budget",
        observedAt: now,
        decision: gasResult.allowed ? "ALLOW" : "BLOCK",
        blockers: gasResult.blockers,
        metrics: gasResult.metrics,
      };
    })(),
    evaluateConsecutiveFailures({
      intent: effectiveIntent,
      auditRecords,
      resumeAfter: strategyCaps.resumeAfterFailureAt || null,
      maxConsecutiveFailures: strategyCaps.maxConsecutiveFailures ?? undefined,
      now,
    }),
    evaluateCapCheck({ intent: effectiveIntent, strategyCaps, auditRecords, activeBudgetUsd, now }),
    evaluateHealthFactorCheck({ intent: effectiveIntent, strategyCaps, now }),
    evaluateLeverageCollateralRule({ strategy: strategyForPolicy, intent: effectiveIntent, now }),
    evaluateStaleQuote({ intent: effectiveIntent, maxAgeMs: strategyCaps.intentTtlMs ?? undefined, now }),
    evaluateGasPriceCeiling({ intent: effectiveIntent, now, profile: riskContext?.aggressionProfile || {} }),
    evaluateApprovalHygiene({ intent: effectiveIntent, now }),
    await evaluatePreBroadcastSimulation({
      intent: effectiveIntent,
      provider: riskContext?.simulationProvider || null,
      now,
      profile: riskContext?.aggressionProfile || {},
    }),
    evaluateAssetCoverageGuard({ intent: effectiveIntent, riskContext, now }),
    evaluateTinyLiveCanaryPolicy({
      intent: effectiveIntent,
      strategyCaps,
      microCanaryStatus: riskContext?.microCanaryStatus || effectiveIntent.metadata?.microCanaryStatus || null,
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
    strategyId: effectiveIntent.strategyId,
    decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
    blockers: [...new Set(blockers)],
    results,
    strategyCaps,
    effectiveIntent,
    amountClamp,
    requiresUnwind,
    emergencyUnwindPath,
  };
}
