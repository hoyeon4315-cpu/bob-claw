import { buildStrategyCatalog } from "./strategy-catalog.mjs";
import { getStrategyCaps } from "../config/strategy-caps.mjs";
import { OPERATOR_COOLDOWN_WAIVERS } from "../config/operator-waivers.mjs";
import { computeTinyCanaryMinProfitablePositionUsd, resolveTinyCanaryExpectedHoldDays } from "../config/sizing.mjs";
import { evaluateNonPrimaryEntryPolicy } from "./non-primary-entry-policy.mjs";
import { selectMerklCanaryAutopilotCandidate } from "../executor/merkl-canary-autopilot.mjs";
import { evGate } from "../executor/policy/ev-gate.mjs";

const LIVE_TRADING_ALLOWED = new Set(["ALLOWED", "ENABLED"]);
const FLASH_LIVE_ALLOWED = new Set(["ALLOWED", "ENABLED", "approved"]);
const BASE_CBBTC_TOKEN = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";
const WRAPPED_BTC_LOOP_STRATEGY_ID = "wrapped-btc-loop-base-moonwell";
const MIN_WRAPPED_BTC_LOOP_LIVE_CAP_USD = 5;
const WRAPPED_BTC_LOOP_AUTOMATED_MAX_LOOP_ITERATIONS = 1;
const WRAPPED_BTC_LOOP_AUTOMATED_MAX_INTENTS = 14;
const WRAPPED_BTC_LOOP_AUTOMATED_MIN_INCREMENT_USD = 5;
const WRAPPED_BTC_LOOP_LIVE_PROOF_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const WRAPPED_BTC_LOOP_RECENT_TX_COOLDOWN_MS = 30 * 60 * 1000;
const WRAPPED_BTC_LOOP_LIVE_PROOF_COOLDOWN_SCOPE = "wrapped_btc_loop_live_proof_cooldown";

function compact(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeAddress(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function unitsArePositive(value = "0") {
  try {
    return BigInt(String(value || "0")) > 0n;
  } catch {
    return false;
  }
}

function requiredCollateralUnitsForCap({ capUsd, priceUsd }) {
  if (!Number.isFinite(capUsd) || capUsd <= 0 || !Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  return String(Math.ceil((capUsd / priceUsd) * 100_000_000));
}

function unitsMeetRequired({ actualUnits = "0", requiredUnits = null }) {
  if (!requiredUnits) return unitsArePositive(actualUnits);
  try {
    return BigInt(String(actualUnits || "0")) >= BigInt(String(requiredUnits));
  } catch {
    return false;
  }
}

function latestTreasuryInventoryRecord(records = []) {
  return (
    [...(records || [])]
      .filter(Boolean)
      .sort((left, right) => String(right.observedAt || "").localeCompare(String(left.observedAt || "")))[0] || null
  );
}

function timestampMs(value = null) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function ageMs(value = null, now = new Date().toISOString()) {
  const observed = timestampMs(value);
  const current = timestampMs(now);
  if (observed === null || current === null) return null;
  return current - observed;
}

function findBaseCbBtcCollateral(treasuryInventoryRecords = []) {
  const latest = latestTreasuryInventoryRecord(treasuryInventoryRecords);
  const token =
    (latest?.tokens || []).find(
      (entry) =>
        String(entry?.chain || "").toLowerCase() === "base" && normalizeAddress(entry?.token) === BASE_CBBTC_TOKEN,
    ) || null;
  const actualUnits = token?.actual || "0";
  return {
    observedAt: latest?.observedAt || null,
    actualUnits,
    actualDecimal: token?.actualDecimal ?? null,
    estimatedUsd: Number(token?.estimatedUsd ?? 0),
    priceUsd: Number(token?.priceUsd ?? 0),
    status: token?.status || null,
    ready: unitsArePositive(actualUnits),
  };
}

function commandScript(command) {
  const match = String(command || "")
    .trim()
    .match(/^npm run\s+([^\s]+)/);
  return match?.[1] || null;
}

function withScripts(commands = []) {
  return (commands || []).map((command) => ({
    command,
    script: commandScript(command),
  }));
}

function liveTradingAllowed(policy = null) {
  return LIVE_TRADING_ALLOWED.has(String(policy?.liveTrading || "").trim());
}

function baseLiveTradingAllowed(policy = null) {
  return LIVE_TRADING_ALLOWED.has(String(policy?.policyLiveTrading || policy?.liveTrading || "").trim());
}

function flashLiveAllowed(policy = null) {
  return FLASH_LIVE_ALLOWED.has(String(policy?.flashLiveAdmission || "").trim());
}

function selectExecutionModeFromPolicy({ rawLiveEligible = false, fallbackMode = "dry_run" } = {}) {
  if (!rawLiveEligible) {
    return {
      currentLiveEligible: false,
      selectedMode: fallbackMode,
    };
  }
  return {
    currentLiveEligible: rawLiveEligible,
    selectedMode: "live",
  };
}

function liveAdmissionBlockers({
  entry,
  liveAllowed,
  flashAllowed = true,
  requiresFlash = false,
  extra = [],
  statusRequired = null,
} = {}) {
  return compact([
    !liveAllowed ? "live_trading_blocked" : null,
    requiresFlash && !flashAllowed ? "flash_live_admission_blocked" : null,
    statusRequired && entry?.status !== statusRequired ? `status_not_${statusRequired}` : null,
    ...(extra || []),
  ]);
}

function laneForGroup(group = null) {
  if (group === "btcFamilies") return "btc_family";
  if (group === "ethBranches") return "eth_branch";
  return "unknown";
}

function proxyCommands(entry, mode) {
  const commands = entry?.commands || [];
  if (mode === "analysis") return commands;
  return commands;
}

function triangleCommands(entry, mode) {
  const commands = entry?.commands || [];
  if (mode === "live") return commands.slice(-1);
  return commands.slice(0, 2);
}

function mixedFlashCommands(entry, mode) {
  const commands = entry?.commands || [];
  if (mode === "live") return commands.slice(-1);
  return commands.slice(0, 1);
}

function phase3ValidationById(phase3Validation = null) {
  return new Map((phase3Validation?.validations || []).map((entry) => [entry.id, entry]));
}

function wrappedBtcLoopLiveCapUsd(baseCbBtcCollateral = null) {
  const caps = getStrategyCaps("wrapped-btc-loop-base-moonwell")?.caps || {};
  const configuredTinyCapUsd = caps.tinyLivePerTxUsd || caps.perTxUsd || 25;
  const collateralUsd = Number(baseCbBtcCollateral?.estimatedUsd ?? 0);
  if (collateralUsd >= MIN_WRAPPED_BTC_LOOP_LIVE_CAP_USD) {
    return Math.max(
      MIN_WRAPPED_BTC_LOOP_LIVE_CAP_USD,
      Math.min(configuredTinyCapUsd, Math.floor(collateralUsd * 0.95 * 100) / 100),
    );
  }
  return configuredTinyCapUsd;
}

function wrappedBtcLoopExpectedNetReady(wrappedBtcLendingLoopSlice = null, validation = null) {
  const readinessFlags = [
    wrappedBtcLendingLoopSlice?.liveExecutionPolicy?.expectedNetReady,
    wrappedBtcLendingLoopSlice?.policyPreview?.expectedNetReady,
    wrappedBtcLendingLoopSlice?.executorIntentPreview?.expectedNetReady,
    validation?.evidence?.perIntentExpectedNetReady,
  ];
  if (readinessFlags.some((value) => value === true)) return true;
  return [
    wrappedBtcLendingLoopSlice?.liveExecutionPolicy?.expectedNetUsd,
    wrappedBtcLendingLoopSlice?.policyPreview?.expectedNetUsd,
    wrappedBtcLendingLoopSlice?.executorIntentPreview?.expectedNetUsd,
    validation?.evidence?.perIntentExpectedNetUsd,
    wrappedBtcLendingLoopSlice?.pnl?.estimated?.valueUsd,
  ].some((value) => Number.isFinite(Number(value)));
}

function wrappedBtcLoopExpectedNetUsd(wrappedBtcLendingLoopSlice = null, validation = null) {
  const candidates = [
    wrappedBtcLendingLoopSlice?.liveExecutionPolicy?.expectedNetUsd,
    wrappedBtcLendingLoopSlice?.policyPreview?.expectedNetUsd,
    wrappedBtcLendingLoopSlice?.executorIntentPreview?.expectedNetUsd,
    validation?.evidence?.perIntentExpectedNetUsd,
    wrappedBtcLendingLoopSlice?.pnl?.estimated?.valueUsd,
  ];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function wrappedBtcLoopEvPreview({
  strategyId = WRAPPED_BTC_LOOP_STRATEGY_ID,
  chain = "base",
  expectedNetUsd = null,
  amountUsd = null,
  now = new Date().toISOString(),
} = {}) {
  const numericExpectedNetUsd = Number(expectedNetUsd);
  if (!Number.isFinite(numericExpectedNetUsd)) return null;
  const numericAmountUsd = Number(amountUsd);
  return evGate(
    {
      strategyId,
      chain,
      intentType: "wrapped_btc_loop_entry",
      amountUsd: Number.isFinite(numericAmountUsd) ? numericAmountUsd : undefined,
      expectedNetUsd: numericExpectedNetUsd,
      observedAt: now,
    },
    null,
    { now },
  );
}

function wrappedBtcLoopProofIsSuccess(proof = null) {
  if (!proof) return false;
  if (proof.strategyId && proof.strategyId !== WRAPPED_BTC_LOOP_STRATEGY_ID) return false;
  return proof.success === true || proof.proofStatus === "signer_backed_roundtrip_recorded";
}

function signerAuditRecordTxHash(record = null) {
  return record?.broadcast?.txHash || record?.lifecycle?.txHash || null;
}

function signerAuditRecordStage(record = null) {
  return record?.lifecycle?.stage || record?.policyVerdict || null;
}

function wrappedBtcLoopRecentSignerActivity(records = [], { now = new Date().toISOString() } = {}) {
  const recent = [];
  const txHashes = new Set();
  for (const record of records || []) {
    if (record?.strategyId !== WRAPPED_BTC_LOOP_STRATEGY_ID) continue;
    const stage = signerAuditRecordStage(record);
    if (!["signed", "broadcasted", "confirmed"].includes(stage)) continue;
    const txHash = signerAuditRecordTxHash(record);
    if (!txHash) continue;
    const age = ageMs(record.timestamp, now);
    if (age === null || age < 0 || age > WRAPPED_BTC_LOOP_RECENT_TX_COOLDOWN_MS) continue;
    recent.push(record);
    txHashes.add(txHash);
  }
  const latest = recent.sort((left, right) => timestampMs(right.timestamp) - timestampMs(left.timestamp))[0] || null;
  return {
    recentTxCount: txHashes.size,
    latestAt: latest?.timestamp || null,
    latestAgeMs: latest ? ageMs(latest.timestamp, now) : null,
  };
}

function wrappedBtcLoopSignerActivityAfter(records = [], { since = null } = {}) {
  const sinceMs = timestampMs(since);
  if (sinceMs === null) {
    return {
      consumed: false,
      consumedAt: null,
      txHash: null,
      stage: null,
    };
  }
  const consumedRecord =
    (records || [])
      .filter((record) => {
        if (record?.strategyId !== WRAPPED_BTC_LOOP_STRATEGY_ID) return false;
        const stage = signerAuditRecordStage(record);
        if (!["signed", "broadcasted", "confirmed"].includes(stage)) return false;
        if (!signerAuditRecordTxHash(record)) return false;
        const recordMs = timestampMs(record.timestamp);
        return recordMs !== null && recordMs > sinceMs;
      })
      .sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp))[0] || null;
  return {
    consumed: Boolean(consumedRecord),
    consumedAt: consumedRecord?.timestamp || null,
    txHash: signerAuditRecordTxHash(consumedRecord),
    stage: signerAuditRecordStage(consumedRecord),
  };
}

function proofObservedAtMatches(waiver = null, liveProof = null) {
  const waivedMs = timestampMs(waiver?.waivesProofObservedAt);
  const proofMs = timestampMs(liveProof?.observedAt);
  return waivedMs !== null && proofMs !== null && waivedMs === proofMs;
}

function resolveWrappedBtcLoopCooldownWaiver({
  waivers = [],
  liveProof = null,
  signerAuditRecords = [],
  now = new Date().toISOString(),
} = {}) {
  const base = {
    applied: false,
    consumed: false,
    waiverId: null,
    reason: null,
    approvedAt: null,
    expiresAt: null,
    waivesProofObservedAt: null,
    consumedAt: null,
    consumedTxHash: null,
    consumedStage: null,
  };
  if (!wrappedBtcLoopProofIsSuccess(liveProof)) return base;
  const nowMs = timestampMs(now);
  const waiver =
    (waivers || []).find((entry) => {
      if (!entry || entry.enabled === false) return false;
      if (entry.strategyId !== WRAPPED_BTC_LOOP_STRATEGY_ID) return false;
      if (entry.scope !== WRAPPED_BTC_LOOP_LIVE_PROOF_COOLDOWN_SCOPE) return false;
      if (!proofObservedAtMatches(entry, liveProof)) return false;
      const approvedMs = timestampMs(entry.operatorApprovedAt);
      const expiresMs = timestampMs(entry.expiresAt);
      if (nowMs === null || approvedMs === null || expiresMs === null) return false;
      if (nowMs < approvedMs || nowMs > expiresMs) return false;
      return Number(entry.maxUses ?? 1) === 1;
    }) || null;
  if (!waiver) return base;
  const consumed = wrappedBtcLoopSignerActivityAfter(signerAuditRecords, {
    since: waiver.operatorApprovedAt,
  });
  return {
    applied: !consumed.consumed,
    consumed: consumed.consumed,
    waiverId: waiver.waiverId || null,
    reason: waiver.reason || null,
    approvedAt: waiver.operatorApprovedAt || null,
    expiresAt: waiver.expiresAt || null,
    waivesProofObservedAt: waiver.waivesProofObservedAt || null,
    consumedAt: consumed.consumedAt,
    consumedTxHash: consumed.txHash,
    consumedStage: consumed.stage,
  };
}

function evaluateWrappedBtcLoopLiveRunControl({
  liveProof = null,
  signerAuditRecords = [],
  operatorCooldownWaivers = [],
  now = new Date().toISOString(),
} = {}) {
  const proofAgeMs = ageMs(liveProof?.observedAt, now);
  const proofObservedMs = timestampMs(liveProof?.observedAt);
  const proofNextEligibleAt =
    wrappedBtcLoopProofIsSuccess(liveProof) && proofObservedMs !== null
      ? new Date(proofObservedMs + WRAPPED_BTC_LOOP_LIVE_PROOF_COOLDOWN_MS).toISOString()
      : null;
  const freshProof =
    wrappedBtcLoopProofIsSuccess(liveProof) &&
    proofAgeMs !== null &&
    proofAgeMs >= 0 &&
    proofAgeMs <= WRAPPED_BTC_LOOP_LIVE_PROOF_COOLDOWN_MS;
  const recent = wrappedBtcLoopRecentSignerActivity(signerAuditRecords, { now });
  const operatorCooldownWaiver = resolveWrappedBtcLoopCooldownWaiver({
    waivers: operatorCooldownWaivers,
    liveProof,
    signerAuditRecords,
    now,
  });
  if (freshProof && operatorCooldownWaiver.consumed) {
    return {
      blocked: true,
      reason: "operator_cooldown_waiver_consumed",
      proofObservedAt: liveProof.observedAt || null,
      proofAgeMs,
      proofCooldownMs: WRAPPED_BTC_LOOP_LIVE_PROOF_COOLDOWN_MS,
      nextEligibleAt: proofNextEligibleAt,
      recentTxCount: recent.recentTxCount,
      latestTxAt: recent.latestAt,
      latestTxAgeMs: recent.latestAgeMs,
      operatorCooldownWaiver,
    };
  }
  if (freshProof && !operatorCooldownWaiver.applied) {
    return {
      blocked: true,
      reason: "fresh_roundtrip_proof_recorded",
      proofObservedAt: liveProof.observedAt || null,
      proofAgeMs,
      proofCooldownMs: WRAPPED_BTC_LOOP_LIVE_PROOF_COOLDOWN_MS,
      nextEligibleAt: proofNextEligibleAt,
      recentTxCount: recent.recentTxCount,
      latestTxAt: recent.latestAt,
      latestTxAgeMs: recent.latestAgeMs,
      operatorCooldownWaiver,
    };
  }
  if (recent.recentTxCount > 0) {
    const latestTxMs = timestampMs(recent.latestAt);
    const recentNextEligibleAt =
      latestTxMs !== null ? new Date(latestTxMs + WRAPPED_BTC_LOOP_RECENT_TX_COOLDOWN_MS).toISOString() : null;
    return {
      blocked: true,
      reason: "recent_live_transaction_cooldown",
      proofObservedAt: liveProof?.observedAt || null,
      proofAgeMs,
      proofCooldownMs: WRAPPED_BTC_LOOP_LIVE_PROOF_COOLDOWN_MS,
      nextEligibleAt: recentNextEligibleAt,
      recentTxCount: recent.recentTxCount,
      latestTxAt: recent.latestAt,
      latestTxAgeMs: recent.latestAgeMs,
      recentTxCooldownMs: WRAPPED_BTC_LOOP_RECENT_TX_COOLDOWN_MS,
      operatorCooldownWaiver,
    };
  }
  return {
    blocked: false,
    reason: null,
    proofObservedAt: liveProof?.observedAt || null,
    proofAgeMs,
    proofCooldownMs: WRAPPED_BTC_LOOP_LIVE_PROOF_COOLDOWN_MS,
    nextEligibleAt: null,
    recentTxCount: 0,
    latestTxAt: null,
    latestTxAgeMs: null,
    recentTxCooldownMs: WRAPPED_BTC_LOOP_RECENT_TX_COOLDOWN_MS,
    operatorCooldownWaiver,
  };
}

function wrappedBtcLoopCommands(mode, { livePerTradeCapUsd = null } = {}) {
  if (mode === "live") {
    return [
      [
        "npm run executor:wrapped-btc-loop --",
        `--per-trade-cap-usd=${livePerTradeCapUsd || wrappedBtcLoopLiveCapUsd()}`,
        `--market-min-increment-usd=${WRAPPED_BTC_LOOP_AUTOMATED_MIN_INCREMENT_USD}`,
        `--max-loop-iterations=${WRAPPED_BTC_LOOP_AUTOMATED_MAX_LOOP_ITERATIONS}`,
        `--max-intents=${WRAPPED_BTC_LOOP_AUTOMATED_MAX_INTENTS}`,
        "--json",
      ].join(" "),
    ];
  }
  return ["npm run report:wrapped-btc-loop -- --json", "npm run report:wrapped-btc-loop-dry-run -- --json"];
}

function buildWrappedBtcLoopExecutorSurface({
  policy,
  phase3Validation = null,
  wrappedBtcLendingLoopSlice = null,
  treasuryInventoryRecords = [],
  wrappedBtcLoopLiveProof = null,
  signerAuditRecords = [],
  operatorCooldownWaivers = [],
  now = new Date().toISOString(),
} = {}) {
  const validation = phase3ValidationById(phase3Validation).get("wrapped_btc_loop_validation") || null;
  const strategy = wrappedBtcLendingLoopSlice?.strategy || {};
  if (!strategy.id) return null;
  const liveAllowed = baseLiveTradingAllowed(policy);
  const runtimeLiveAllowed = liveTradingAllowed(policy);
  const validationPassed = validation?.overallStatus === "passed";
  const bindingReady = wrappedBtcLendingLoopSlice?.bindingSupport?.executableFromRepo === true;
  const dryRunRecorded = wrappedBtcLendingLoopSlice?.dryRunSummary?.dryRunReceiptRecorded === true;
  const baseCbBtcCollateral = findBaseCbBtcCollateral(treasuryInventoryRecords);
  const livePerTradeCapUsd = wrappedBtcLoopLiveCapUsd(baseCbBtcCollateral);
  const requiredCollateralUnits = requiredCollateralUnitsForCap({
    capUsd: livePerTradeCapUsd,
    priceUsd: baseCbBtcCollateral.priceUsd,
  });
  const collateralReady = unitsMeetRequired({
    actualUnits: baseCbBtcCollateral.actualUnits,
    requiredUnits: requiredCollateralUnits,
  });
  const expectedNetReady = wrappedBtcLoopExpectedNetReady(wrappedBtcLendingLoopSlice, validation);
  const expectedNetUsd = wrappedBtcLoopExpectedNetUsd(wrappedBtcLendingLoopSlice, validation);
  const evPreview = wrappedBtcLoopEvPreview({
    strategyId: strategy.id || WRAPPED_BTC_LOOP_STRATEGY_ID,
    chain: strategy.chain || "base",
    expectedNetUsd,
    amountUsd: livePerTradeCapUsd,
    now,
  });
  const liveRunControl = evaluateWrappedBtcLoopLiveRunControl({
    liveProof: wrappedBtcLoopLiveProof,
    signerAuditRecords,
    operatorCooldownWaivers,
    now,
  });
  const rawLiveEligible =
    liveAllowed &&
    validationPassed &&
    bindingReady &&
    dryRunRecorded &&
    collateralReady &&
    !liveRunControl.blocked &&
    expectedNetReady &&
    evPreview?.allow === true;
  const mode = selectExecutionModeFromPolicy({
    rawLiveEligible,
    fallbackMode: "dry_run",
  });
  const blockers = compact([
    !runtimeLiveAllowed ? "live_trading_blocked" : null,
    validationPassed ? null : validation?.blockers?.[0] || "phase3_validation_not_passed",
    bindingReady ? null : "repo_auto_build_not_supported",
    dryRunRecorded ? null : "dry_run_receipt_missing",
    collateralReady ? null : "base_cbbtc_collateral_unavailable",
    liveRunControl.blocked ? liveRunControl.reason : null,
    expectedNetReady ? null : "expected_net_unmeasured",
    ...(expectedNetReady ? evPreview?.blockers || [] : []),
  ]);
  const currentLiveEligible = mode.currentLiveEligible && runtimeLiveAllowed;
  const selectedMode = currentLiveEligible
    ? mode.selectedMode
    : mode.selectedMode === "live"
      ? "dry_run"
      : mode.selectedMode;
  return {
    id: strategy.id,
    label: strategy.label || "Wrapped BTC lending loop (Base / Moonwell)",
    lane: "btc_family",
    status: validationPassed ? "candidate_for_validation" : "analysis_only",
    reason: currentLiveEligible ? "phase3_validation_passed" : blockers[0] || "phase3_validation_not_passed",
    evidence: {
      phase3OverallStatus: validation?.overallStatus || null,
      oosSplitStatus: validation?.oosSplitStatus || null,
      shockTestStatus: validation?.shockTestStatus || null,
      liveRoundtripProofStatus: validation?.evidence?.liveRoundtripProofStatus || null,
      extendedReceiptContextReady: validation?.evidence?.extendedReceiptContextReady ?? null,
      dryRunReceiptRecorded: dryRunRecorded,
      signerBackedRunCount: wrappedBtcLendingLoopSlice?.dryRunSummary?.signerBackedRunCount ?? 0,
      baseCbBtcCollateralUnits: baseCbBtcCollateral.actualUnits,
      baseCbBtcCollateralDecimal: baseCbBtcCollateral.actualDecimal,
      baseCbBtcCollateralUsd: baseCbBtcCollateral.estimatedUsd,
      baseCbBtcPriceUsd: baseCbBtcCollateral.priceUsd || null,
      baseCbBtcRequiredUnits: requiredCollateralUnits,
      baseCbBtcCollateralStatus: baseCbBtcCollateral.status,
      treasuryInventoryObservedAt: baseCbBtcCollateral.observedAt,
      livePerTradeCapUsd,
      expectedNetReady,
      expectedNetUsd,
      expectedNetPolicySource: expectedNetReady ? "wrapped_btc_loop_policy_preview" : null,
      expectedNetRequiredUsd: evPreview?.evidence?.requiredNetUsd ?? null,
      expectedNetP90CostUsd: evPreview?.evidence?.p90CostUsd ?? null,
      expectedNetCostSource: evPreview?.evidence?.costSource ?? null,
      expectedNetSampleCount: evPreview?.evidence?.sampleCount ?? null,
      projectedAnnualNetCarryBtc: null,
      projectedAnnualNetCarryUsd: wrappedBtcLendingLoopSlice?.pnl?.paper?.annualNetCarryUsd ?? null,
      estimatedNetCarryBtc: null,
      estimatedNetCarryUsd: wrappedBtcLendingLoopSlice?.pnl?.estimated?.valueUsd ?? null,
      realizedNetCarryBtc: null,
      realizedNetCarryUsd:
        validation?.evidence?.realizedNetCarryUsd ?? wrappedBtcLendingLoopSlice?.pnl?.realized?.valueUsd ?? null,
      liveRunControl,
    },
    capabilityBucket: currentLiveEligible ? "executable_now" : "dry_run_or_shadow_only",
    runnerKind: "command_sequence",
    liveCapable: true,
    currentLiveEligible,
    selectedMode,
    fallbackReason: currentLiveEligible ? null : blockers[0] || "phase3_validation_not_passed",
    missingCapabilities: blockers.filter((blocker) => blocker !== "live_trading_blocked"),
    liveAdmissionBlockers: currentLiveEligible ? [] : blockers,
    selectedCommands: withScripts(wrappedBtcLoopCommands(selectedMode, { livePerTradeCapUsd })),
  };
}

function adviceSourceForStrategy(strategy = {}) {
  const code = strategy.fallbackReason || strategy.liveAdmissionBlockers?.[0] || null;
  if (strategy.id === WRAPPED_BTC_LOOP_STRATEGY_ID) {
    if (String(code || "").includes("collateral")) return "treasury_inventory";
    if (String(code || "").includes("phase3")) return "phase3_evidence_file";
    return "slice_summary";
  }
  if (strategy.id === "gateway_native_asset_conversion_sleeve") return "slice_summary";
  return "slice_summary";
}

function withReportingOnlyAdvice(strategy = {}) {
  const adviceCode = strategy.adviceCode || strategy.liveAdmissionBlockers?.[0] || strategy.fallbackReason || null;
  return {
    ...strategy,
    reportingOnly: true,
    runtimeGateAuthority: "policy_engine_only",
    adviceCode,
    adviceFields: ["liveAdmissionBlockers", "fallbackReason", "currentLiveEligible"],
    adviceSource: strategy.adviceSource || adviceSourceForStrategy(strategy),
    adviceAuthority: "commit_time_guard",
  };
}

function merklAutopilotCommands(mode) {
  if (mode === "live") return ["npm run executor:merkl-canary-autopilot -- --json --write --execute"];
  return ["npm run report:merkl-canary-queue -- --json"];
}

function merklCandidateAmountUsd(candidate = null) {
  const values = [
    candidate?.executionReadiness?.matchedToken?.estimatedUsd,
    candidate?.sizing?.amountUsd,
    candidate?.amountUsd,
  ];
  return values.find((value) => Number.isFinite(Number(value)) && Number(value) > 0) ?? null;
}

function merklExpectedHoldDays(candidate = null) {
  return resolveTinyCanaryExpectedHoldDays({
    expectedHoldDays: candidate?.expectedHoldDays,
    campaignRemainingHours: candidate?.campaignRemainingHours,
    campaignEndsAt: candidate?.campaignEndsAt,
    now: candidate?.observedAt,
  });
}

function merklExitPathReady(candidate = null) {
  const bindingKind = String(candidate?.protocolBindingPlan?.bindingKind || "");
  const actions = candidate?.protocolBindingPlan?.canaryActions || [];
  return (
    /withdraw|redeem/u.test(bindingKind) ||
    actions.some((action) => /withdraw|redeem|unwind/u.test(String(action || "")))
  );
}

function merklPolicyPreviewBlockers(candidate = null) {
  if (!candidate) return ["merkl_auto_executable_candidate_missing"];
  const amountUsd = Number(merklCandidateAmountUsd(candidate));
  const blockers = [];
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    blockers.push("merkl_candidate_amount_missing");
  }
  if (!merklExitPathReady(candidate)) {
    blockers.push("exit_path_unproven");
  }

  const chain = candidate.chain || null;
  const expectedNetEvUsd = candidate.expectedNetEvUsd ?? candidate.expectedRealizedNetUsd ?? candidate.netUsd;
  if (Number.isFinite(Number(expectedNetEvUsd))) {
    const evGate = evaluateNonPrimaryEntryPolicy({
      candidate: {
        chain,
        notionalUsd: amountUsd,
        expectedNetEvUsd,
        rung: "tiny_canary",
        p90RoundTripCostUsd: candidate.p90RoundTripCostUsd,
        estimatedGasCostUsd: candidate.estimatedGasCostUsd,
        rewardToken: candidate.rewardToken || null,
        rewardTokenAddress: candidate.rewardTokenAddress || null,
        rewardAsset: candidate.rewardAsset || null,
        rewardExitCostUsd: candidate.rewardExitCostUsd,
        claimSwapCostUsd: candidate.claimSwapCostUsd,
      },
    });
    blockers.push(...evGate.blockers.filter((blocker) => blocker !== "candidate_amount_missing"));
  } else {
    const minProfitable = computeTinyCanaryMinProfitablePositionUsd({
      chain,
      aprPct: Number(candidate.aprPct ?? candidate.nativeAprPct ?? 0),
      expectedHoldDays: merklExpectedHoldDays(candidate),
      estimatedGasCostUsd: candidate.estimatedGasCostUsd,
    });
    if (Number.isFinite(amountUsd) && minProfitable !== null && amountUsd < minProfitable) {
      blockers.push(`same_chain_unprofitable:need_$${Math.ceil(minProfitable)}_on_${chain || "unknown"}`);
    }
  }
  return compact(blockers);
}

function merklAutopilotLatestBlockers(latest = null) {
  if (!latest || typeof latest !== "object") return [];
  const summary = latest.summary || {};
  const status = String(latest.status || "");
  const executionReadyCount = Number(summary.executionReadyCount ?? 0);
  const previewReadyCount = Number(summary.previewReadyCount ?? 0);
  const deliveredCount = Number(summary.deliveredCount ?? 0);
  const filteredCount = Number(summary.filteredCount ?? 0);
  const blockedCount = Number(summary.blockedCount ?? 0);
  const statusHasBlockers = ["blocked", "completed_with_blockers", "failed", "error"].includes(status);
  const noExecutableSelection =
    statusHasBlockers &&
    executionReadyCount <= 0 &&
    previewReadyCount <= 0 &&
    deliveredCount <= 0 &&
    (blockedCount > 0 || filteredCount > 0 || status !== "completed");
  if (!noExecutableSelection) return [];
  const blockers = [];
  if (latest.blockedReason) blockers.push(latest.blockedReason);
  if (latest.filteredReason) blockers.push(latest.filteredReason);
  if (summary.topBlocker) blockers.push(summary.topBlocker);
  const counts = summary.blockerCounts || {};
  blockers.push(...Object.keys(counts));
  if (blockers.length === 0 && status) blockers.push(`merkl_autopilot_${status}`);
  return [...new Set(blockers.filter(Boolean))];
}

function summarizeMerklQueueForSurface(queue = []) {
  const executableNowCount = queue.filter((item) => item?.executionReadiness?.status === "inventory_ready").length;
  const autoExecutableNowCount = queue.filter((item) => item?.autoEntry?.autoExecute === true).length;
  return {
    queueCount: queue.length,
    executableNowCount,
    autoExecutableNowCount,
    topBlockingReason:
      queue.length === 0
        ? null
        : executableNowCount > 0
          ? "executable_candidate_available"
          : queue[0]?.executionReadiness?.status || queue[0]?.capabilityGaps?.[0] || "unknown",
  };
}

function buildMerklAutopilotSurface({
  policy,
  merklCanaryQueue = null,
  merklCanaryAutopilotLatest = null,
  liveTreasuryInventorySnapshot = null,
  now = null,
  strategyId = null,
  label = "Merkl tiny live canary autopilot",
} = {}) {
  const queue = (merklCanaryQueue?.queue || []).filter((item) =>
    strategyId ? item?.mappedStrategyId === strategyId : true,
  );
  const summary = strategyId ? summarizeMerklQueueForSurface(queue) : merklCanaryQueue?.summary || {};
  const liveSelection = liveTreasuryInventorySnapshot
    ? selectMerklCanaryAutopilotCandidate(
        { ...(merklCanaryQueue || {}), summary, queue },
        {
          inventorySnapshot: liveTreasuryInventorySnapshot,
          now: now || new Date().toISOString(),
        },
      )
    : null;
  const topReady =
    liveSelection?.selected?.queueItem ||
    queue.find(
      (item) =>
        item?.autoEntry?.autoExecute === true &&
        item?.executionReadiness?.status === "inventory_ready" &&
        (item?.capabilityGaps || []).length === 0,
    ) ||
    queue.find((item) => item?.queueStatus === "ready_for_tiny_live_canary") ||
    null;
  if ((!merklCanaryQueue && !topReady) || queue.length === 0) return null;
  const policyPreviewBlockers = merklPolicyPreviewBlockers(topReady);
  const latestAutopilotBlockers = merklAutopilotLatestBlockers(merklCanaryAutopilotLatest);
  const liveReadyCount = liveSelection?.readyCount ?? summary.autoExecutableNowCount ?? 0;
  const blockers = compact([
    liveReadyCount > 0 ? null : summary.topBlockingReason || "merkl_auto_executable_candidate_missing",
    ...policyPreviewBlockers,
    ...latestAutopilotBlockers,
  ]);
  const rawLiveEligible = liveReadyCount > 0 && Boolean(topReady) && blockers.length === 0;
  const mode = selectExecutionModeFromPolicy({
    rawLiveEligible,
    fallbackMode: "analysis",
  });
  const currentLiveEligible = mode.currentLiveEligible;
  const selectedMode = mode.selectedMode;
  return {
    id: strategyId || "gateway_native_asset_conversion_sleeve",
    label,
    lane: "yield_sleeve",
    status: currentLiveEligible ? "candidate_for_validation" : "analysis_only",
    reason: currentLiveEligible ? "auto_executable_merkl_candidate_available" : blockers[0] || "merkl_queue_not_ready",
    evidence: {
      queueCount: summary.queueCount ?? 0,
      executableNowCount: summary.executableNowCount ?? 0,
      autoExecutableNowCount: liveReadyCount,
      topOpportunityId: topReady?.opportunityId || summary.topExecutableOpportunityId || null,
      topProtocolId: topReady?.protocolId || null,
      projectedPnlBtc: null,
      projectedPnlUsd: null,
      candidateAprPct: topReady?.aprPct ?? null,
      estimatedPnlBtc: null,
      estimatedPnlUsd: topReady?.executionReadiness?.matchedToken?.estimatedUsd ?? null,
      realizedPnlBtc: null,
      realizedPnlUsd: null,
      exitPathReady: merklExitPathReady(topReady),
      latestAutopilotStatus: merklCanaryAutopilotLatest?.status || null,
      latestAutopilotBlockedReason: merklCanaryAutopilotLatest?.blockedReason || null,
      latestAutopilotFilteredReason: merklCanaryAutopilotLatest?.filteredReason || null,
      latestAutopilotExecutionReadyCount: merklCanaryAutopilotLatest?.summary?.executionReadyCount ?? null,
      latestAutopilotPreviewReadyCount: merklCanaryAutopilotLatest?.summary?.previewReadyCount ?? null,
      latestAutopilotDeliveredCount: merklCanaryAutopilotLatest?.summary?.deliveredCount ?? null,
      latestAutopilotFilteredCount: merklCanaryAutopilotLatest?.summary?.filteredCount ?? null,
      latestAutopilotBlockedCount: merklCanaryAutopilotLatest?.summary?.blockedCount ?? null,
      latestAutopilotTopBlocker: merklCanaryAutopilotLatest?.summary?.topBlocker || null,
      liveInventoryObservedAt: liveTreasuryInventorySnapshot?.observedAt || null,
      dashboardLiveTrading: policy?.liveTrading || null,
      dashboardPolicyLiveTrading: policy?.policyLiveTrading || null,
    },
    capabilityBucket: currentLiveEligible ? "executable_now" : "dry_run_or_shadow_only",
    runnerKind: "command_sequence",
    liveCapable: true,
    currentLiveEligible,
    selectedMode,
    fallbackReason: currentLiveEligible ? null : blockers[0] || "merkl_queue_not_ready",
    missingCapabilities: blockers.filter((blocker) => blocker !== "live_trading_blocked"),
    liveAdmissionBlockers: currentLiveEligible ? [] : blockers,
    selectedCommands: withScripts(merklAutopilotCommands(selectedMode)),
  };
}

function buildMerklAutopilotSurfaces(options = {}) {
  return [
    buildMerklAutopilotSurface(options),
    buildMerklAutopilotSurface({
      ...options,
      strategyId: "pendle-yt-canary",
      label: "Pendle YT canary autopilot",
    }),
  ].filter(Boolean);
}

function buildSurface(entry, { group, policy }) {
  const lane = laneForGroup(group);
  const liveAllowed = liveTradingAllowed(policy);
  const flashAllowed = flashLiveAllowed(policy);
  const shared = {
    id: entry.id,
    label: entry.label,
    lane,
    status: entry.status,
    reason: entry.reason || null,
    evidence: entry.evidence || {},
  };

  switch (entry.id) {
    case "gateway_wrapped_btc_loops": {
      const selectedMode = "shadow";
      const selectedCommands = entry.commands || [];
      const blockers = liveAdmissionBlockers({
        entry,
        liveAllowed,
        extra: ["route_specific_executor_inputs_required"],
      });
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: true,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "route_specific_executor_inputs_required",
        missingCapabilities: [],
        liveAdmissionBlockers: blockers,
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "btc_proxy_spreads": {
      const selectedMode = "shadow";
      const selectedCommands = proxyCommands(entry, selectedMode);
      const blockers = liveAdmissionBlockers({
        entry,
        liveAllowed,
        extra: ["route_specific_executor_inputs_required"],
      });
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: true,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "route_specific_executor_inputs_required",
        missingCapabilities: [],
        liveAdmissionBlockers: blockers,
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "stablecoin_entry_exit_loops": {
      const selectedMode = "analysis";
      const selectedCommands = entry.commands || [];
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: false,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "analysis_probe_only",
        missingCapabilities: [],
        liveAdmissionBlockers: liveAdmissionBlockers({
          entry,
          liveAllowed,
          extra: ["analysis_probe_only", "live_executor_not_bound"],
        }),
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "tokenized_gold_rotation": {
      const rawLiveEligible =
        entry.evidence?.liveEligible === true && entry.status === "candidate_for_validation" && liveAllowed;
      const currentLiveEligible = rawLiveEligible;
      const selectedMode = currentLiveEligible ? "live" : "analysis";
      const selectedCommands = entry.commands || [];
      const blockers = compact([
        entry.reason,
        ...liveAdmissionBlockers({
          entry,
          liveAllowed,
          statusRequired: "candidate_for_validation",
        }),
      ]);
      return {
        ...shared,
        capabilityBucket: currentLiveEligible ? "executable_now" : "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: true,
        currentLiveEligible,
        selectedMode,
        fallbackReason: currentLiveEligible ? null : blockers[0] || "gateway_gold_preflight_required",
        missingCapabilities: blockers.filter((blocker) => blocker !== "live_trading_blocked"),
        liveAdmissionBlockers: currentLiveEligible ? [] : blockers,
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "triangular_flash_btc": {
      const rawLiveEligible =
        entry.status === "candidate_for_validation" && baseLiveTradingAllowed(policy) && flashAllowed;
      const mode = selectExecutionModeFromPolicy({
        rawLiveEligible,
        fallbackMode: "dry_run",
      });
      const currentLiveEligible = mode.currentLiveEligible;
      const selectedMode = mode.selectedMode;
      const selectedCommands = triangleCommands(entry, selectedMode);
      const blockers = compact([
        ...liveAdmissionBlockers({
          entry,
          liveAllowed,
          flashAllowed,
          requiresFlash: true,
          statusRequired: "candidate_for_validation",
        }),
      ]);
      return {
        ...shared,
        capabilityBucket: currentLiveEligible ? "executable_now" : "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: true,
        currentLiveEligible,
        selectedMode,
        fallbackReason: currentLiveEligible
          ? null
          : compact([
              !flashAllowed ? "flash_live_admission_blocked" : null,
              !baseLiveTradingAllowed(policy) ? "live_trading_blocked" : null,
              entry.status !== "candidate_for_validation" ? entry.status : null,
            ])[0] || "fallback_to_dry_run",
        missingCapabilities: compact([
          !flashAllowed ? "flash_live_admission_blocked" : null,
          !baseLiveTradingAllowed(policy) ? "live_trading_blocked" : null,
        ]),
        liveAdmissionBlockers: currentLiveEligible ? [] : blockers,
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "eth_family_gateway": {
      const selectedMode = "shadow";
      const selectedCommands = entry.commands || [];
      const blockers = liveAdmissionBlockers({
        entry,
        liveAllowed,
        extra: ["multichain_eth_surface_unconfirmed"],
      });
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: true,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "multichain_eth_surface_unconfirmed",
        missingCapabilities: ["multichain_eth_surface_unconfirmed"],
        liveAdmissionBlockers: blockers,
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "eth_mixed_stable_loops": {
      const selectedMode = "analysis";
      const selectedCommands = entry.commands || [];
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: false,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "analysis_probe_only",
        missingCapabilities: [],
        liveAdmissionBlockers: liveAdmissionBlockers({
          entry,
          liveAllowed,
          extra: ["analysis_probe_only", "live_executor_not_bound"],
        }),
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "eth_dex_spread_mixed": {
      const selectedMode = "analysis";
      const selectedCommands = entry.commands || [];
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: false,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "mixed_triangle_branch_observe_only",
        missingCapabilities: [],
        liveAdmissionBlockers: liveAdmissionBlockers({
          entry,
          liveAllowed,
          extra: ["mixed_triangle_branch_observe_only", "live_executor_not_bound"],
        }),
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "eth_mixed_flash": {
      const rawLiveEligible =
        entry.status === "candidate_for_validation" && baseLiveTradingAllowed(policy) && flashAllowed;
      const mode = selectExecutionModeFromPolicy({
        rawLiveEligible,
        fallbackMode: "dry_run",
      });
      const currentLiveEligible = mode.currentLiveEligible;
      const selectedMode = mode.selectedMode;
      const selectedCommands = mixedFlashCommands(entry, selectedMode);
      const blockers = compact([
        ...liveAdmissionBlockers({
          entry,
          liveAllowed,
          flashAllowed,
          requiresFlash: true,
          statusRequired: "candidate_for_validation",
          extra: ["contract_not_generalized"],
        }),
      ]);
      return {
        ...shared,
        capabilityBucket: currentLiveEligible ? "executable_now" : "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: true,
        currentLiveEligible,
        selectedMode,
        fallbackReason: currentLiveEligible
          ? null
          : compact([
              !flashAllowed ? "flash_live_admission_blocked" : null,
              !baseLiveTradingAllowed(policy) ? "live_trading_blocked" : null,
              entry.status !== "candidate_for_validation" ? entry.status : null,
            ])[0] || "fallback_to_flash_dry_run",
        missingCapabilities: compact([
          "contract_not_generalized",
          !flashAllowed ? "flash_live_admission_blocked" : null,
          !baseLiveTradingAllowed(policy) ? "live_trading_blocked" : null,
        ]),
        liveAdmissionBlockers: currentLiveEligible ? [] : blockers,
        selectedCommands: withScripts(selectedCommands),
      };
    }
    case "defillama-yield-portfolio": {
      const selectedMode = "analysis";
      const selectedCommands = entry.commands || [];
      return {
        ...shared,
        capabilityBucket: "dry_run_or_shadow_only",
        runnerKind: "command_sequence",
        liveCapable: false,
        currentLiveEligible: false,
        selectedMode,
        fallbackReason: "analysis_probe_only",
        missingCapabilities: [],
        liveAdmissionBlockers: liveAdmissionBlockers({
          entry,
          liveAllowed,
          extra: ["analysis_probe_only", "live_executor_not_bound"],
        }),
        selectedCommands: withScripts(selectedCommands),
      };
    }
    default: {
      return {
        ...shared,
        capabilityBucket: "missing_executor_adapter",
        runnerKind: "unknown",
        liveCapable: false,
        currentLiveEligible: false,
        selectedMode: "analysis",
        fallbackReason: "unclassified_strategy_surface",
        missingCapabilities: ["unclassified_strategy_surface"],
        liveAdmissionBlockers: ["unclassified_strategy_surface"],
        selectedCommands: withScripts(entry.commands || []),
      };
    }
  }
}

export function buildStrategyExecutionSurfaces({
  dashboardStatus = null,
  state = {},
  triangleArtifacts = {},
  artifacts = {},
  now = null,
} = {}) {
  const catalog = buildStrategyCatalog({ dashboardStatus, state, triangleArtifacts });
  const strategies = [
    ...(catalog.btcFamilies || []).map((entry) =>
      buildSurface(entry, { group: "btcFamilies", policy: catalog.policy }),
    ),
    ...(catalog.ethBranches || []).map((entry) =>
      buildSurface(entry, { group: "ethBranches", policy: catalog.policy }),
    ),
    buildWrappedBtcLoopExecutorSurface({
      policy: catalog.policy,
      phase3Validation: artifacts.phase3StrategyValidation || null,
      wrappedBtcLendingLoopSlice: artifacts.wrappedBtcLendingLoopSlice || null,
      treasuryInventoryRecords: artifacts.treasuryInventoryRecords || [],
      wrappedBtcLoopLiveProof: artifacts.wrappedBtcLoopLiveProof || null,
      signerAuditRecords: artifacts.signerAuditRecords || [],
      operatorCooldownWaivers: artifacts.operatorCooldownWaivers || OPERATOR_COOLDOWN_WAIVERS,
      now: now || catalog.generatedAt || new Date().toISOString(),
    }),
    ...buildMerklAutopilotSurfaces({
      policy: catalog.policy,
      merklCanaryQueue: artifacts.merklCanaryQueue || null,
      merklCanaryAutopilotLatest: artifacts.merklCanaryAutopilotLatest || null,
      liveTreasuryInventorySnapshot: artifacts.liveTreasuryInventorySnapshot || null,
      now: now || catalog.generatedAt || new Date().toISOString(),
    }),
  ]
    .filter(Boolean)
    .map(withReportingOnlyAdvice);
  const bucketCounts = strategies.reduce((counts, strategy) => {
    counts[strategy.capabilityBucket] = (counts[strategy.capabilityBucket] || 0) + 1;
    return counts;
  }, {});
  const selectedModeCounts = strategies.reduce((counts, strategy) => {
    counts[strategy.selectedMode] = (counts[strategy.selectedMode] || 0) + 1;
    return counts;
  }, {});
  const runnableStrategies = strategies.filter((strategy) => strategy.selectedCommands.length > 0);
  return {
    schemaVersion: 1,
    generatedAt: now || catalog.generatedAt || new Date().toISOString(),
    policy: catalog.policy,
    summary: {
      strategyCount: strategies.length,
      runnableCount: runnableStrategies.length,
      liveEligibleCount: strategies.filter((strategy) => strategy.currentLiveEligible).length,
      missingExecutorCount: strategies.filter((strategy) => strategy.capabilityBucket === "missing_executor_adapter")
        .length,
      bucketCounts,
      selectedModeCounts,
      topRunnableId: runnableStrategies[0]?.id || null,
    },
    strategies,
  };
}
