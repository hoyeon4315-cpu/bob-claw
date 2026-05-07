import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { WBTC_OFT_TOKEN, WRAPPED_NATIVE_TOKENS, ZERO_TOKEN, normalizeToken, tokenAsset } from "../assets/tokens.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../treasury/policy.mjs";
import { scanWholeWalletInventory } from "../treasury/whole-wallet-scan.mjs";
import { STABLE_QUOTE_TOKENS } from "../dex/odos.mjs";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import { readSignerHealth, signerClientTimeoutMs, signerSocketPath } from "./signer/client.mjs";
import { readSignerAuditLog } from "./signer/audit-log.mjs";
import { buildNativeDexExperimentPlan, executeNativeDexExperimentPlan } from "./helpers/native-dex-experiment.mjs";
import { buildTokenDexExperimentPlan, executeTokenDexExperimentPlan } from "./helpers/token-dex-experiment.mjs";

const DEFAULT_TINY_USD = 0.1;
const DEFAULT_MIN_HOLDING_USD = 0.02;
const DEFAULT_CHAIN_QUARANTINE_MS = 30 * 60_000;
const DEFAULT_OUTPUT_ASSET_COOLDOWN_MS = 10 * 60_000;
const TOKEN_MAX_BALANCE_BPS = 2_500;
const NATIVE_MAX_BALANCE_BPS = 500;
const DEFAULT_DASHBOARD_CONTEXT_IMPL = buildCurrentDashboardContext;

function lowerSet(values = []) {
  return new Set((values || []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean));
}

function isAllowedChain(chain, includeChains = null, excludeChains = []) {
  const normalized = String(chain || "").toLowerCase();
  const include = includeChains?.length ? lowerSet(includeChains) : null;
  const exclude = lowerSet(excludeChains);
  if (include && !include.has(normalized)) return false;
  return !exclude.has(normalized);
}

function holdingUsd(holding = {}) {
  return Number.isFinite(holding.estimatedUsd) ? Number(holding.estimatedUsd) : null;
}

function withCandidateId(candidate) {
  const route =
    candidate.kind === "native_dex"
      ? `${candidate.chain}:native->${candidate.chain}:${normalizeToken(candidate.outputToken)}`
      : `${candidate.chain}:${normalizeToken(candidate.inputToken)}->${candidate.chain}:${normalizeToken(candidate.outputToken)}`;
  return {
    id: `${candidate.kind}:${route}`,
    routeKey: route,
    ...candidate,
  };
}

export function decimalToUnits(value, decimals = 18) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/u.test(raw)) throw new Error(`Invalid decimal amount: ${value}`);
  const [whole, fraction = ""] = raw.split(".");
  const padded = `${fraction}${"0".repeat(decimals)}`.slice(0, decimals);
  return (BigInt(whole) * (10n ** BigInt(decimals))) + BigInt(padded || "0");
}

function amountFromTargetUsd({
  holding,
  targetUsd,
  maxBalanceBps,
} = {}) {
  const balance = BigInt(holding?.balance || 0);
  if (balance <= 0n) return null;
  const estimatedUsd = holdingUsd(holding);
  let amount = 0n;
  if (estimatedUsd && estimatedUsd > 0) {
    const targetMicros = BigInt(Math.max(1, Math.floor(Number(targetUsd) * 1_000_000)));
    const estimatedMicros = BigInt(Math.max(1, Math.floor(estimatedUsd * 1_000_000)));
    amount = (balance * targetMicros) / estimatedMicros;
  } else {
    amount = (balance * BigInt(maxBalanceBps)) / 10_000n;
  }
  const maxByBalance = (balance * BigInt(maxBalanceBps)) / 10_000n;
  if (maxByBalance > 0n && amount > maxByBalance) amount = maxByBalance;
  if (amount > balance) amount = balance;
  if (amount <= 0n) return null;
  return amount.toString();
}

function blockedCandidate(base, blockedReason) {
  return withCandidateId({
    ...base,
    status: "blocked",
    blockedReason,
  });
}

function tokenDexCandidate(holding, options) {
  const chain = holding.chain;
  const sourceUsd = holdingUsd(holding);
  const base = {
    kind: "token_dex",
    chain,
    inputToken: holding.token,
    inputTicker: holding.ticker || tokenAsset(chain, holding.token).ticker,
    inputFamily: holding.family || tokenAsset(chain, holding.token).family,
    sourceBalance: holding.balance,
    sourceEstimatedUsd: sourceUsd,
    amount: null,
    outputToken: null,
    outputTicker: null,
    status: "candidate",
    blockedReason: null,
  };
  if (!isAllowedChain(chain, options.chains, options.excludeChains)) {
    return blockedCandidate(base, "excluded_chain");
  }
  if (sourceUsd !== null && sourceUsd < options.minHoldingUsd) {
    return blockedCandidate(base, "below_min_holding_usd");
  }
  if (base.inputFamily === "wrapped_btc") {
    return blockedCandidate(base, "wrapped_btc_reserved_for_gateway_or_payback");
  }
  if (normalizeToken(holding.token) === normalizeToken(WBTC_OFT_TOKEN)) {
    return blockedCandidate(base, "wrapped_btc_reserved_for_gateway_or_payback");
  }

  let outputToken = null;
  if (base.inputFamily === "stablecoin") {
    outputToken = WRAPPED_NATIVE_TOKENS[chain] || null;
  } else {
    outputToken = STABLE_QUOTE_TOKENS[chain]?.token || null;
  }
  if (!outputToken) return blockedCandidate(base, "no_supported_output_token");
  if (normalizeToken(outputToken) === normalizeToken(holding.token)) {
    return blockedCandidate(base, "input_output_same_token");
  }

  const amount = amountFromTargetUsd({
    holding,
    targetUsd: options.tinyUsd,
    maxBalanceBps: TOKEN_MAX_BALANCE_BPS,
  });
  if (!amount) return blockedCandidate(base, "probe_amount_too_small");

  return withCandidateId({
    ...base,
    amount,
    outputToken,
    outputTicker: tokenAsset(chain, outputToken).ticker,
  });
}

function nativeDexCandidate(holding, options) {
  const chain = holding.chain;
  const sourceUsd = holdingUsd(holding);
  const outputToken = STABLE_QUOTE_TOKENS[chain]?.token || null;
  const base = {
    kind: "native_dex",
    chain,
    inputToken: ZERO_TOKEN,
    inputTicker: holding.ticker || tokenAsset(chain, ZERO_TOKEN).ticker,
    inputFamily: holding.family || tokenAsset(chain, ZERO_TOKEN).family,
    sourceBalance: holding.balance,
    sourceEstimatedUsd: sourceUsd,
    amount: null,
    outputToken,
    outputTicker: outputToken ? tokenAsset(chain, outputToken).ticker : null,
    status: "candidate",
    blockedReason: null,
  };
  if (chain === "bitcoin") return blockedCandidate(base, "bitcoin_native_not_evm_dex");
  if (!isAllowedChain(chain, options.chains, options.excludeChains)) return blockedCandidate(base, "excluded_chain");
  if (sourceUsd !== null && sourceUsd < options.minHoldingUsd) return blockedCandidate(base, "below_min_holding_usd");
  if (!outputToken) return blockedCandidate(base, "no_stable_output_token");

  const amount = amountFromTargetUsd({
    holding,
    targetUsd: options.nativeTinyUsd,
    maxBalanceBps: NATIVE_MAX_BALANCE_BPS,
  });
  if (!amount) return blockedCandidate(base, "probe_amount_too_small");

  return withCandidateId({
    ...base,
    amount,
  });
}

export function buildLiveCanaryCandidates({
  inventory,
  chains = null,
  excludeChains = [],
  tinyUsd = DEFAULT_TINY_USD,
  nativeTinyUsd = DEFAULT_TINY_USD,
  minHoldingUsd = DEFAULT_MIN_HOLDING_USD,
} = {}) {
  const options = { chains, excludeChains, tinyUsd, nativeTinyUsd, minHoldingUsd };
  const tokenCandidates = (inventory?.tokenBalances || []).map((holding) => tokenDexCandidate(holding, options));
  const nativeCandidates = (inventory?.native || []).map((holding) => nativeDexCandidate(holding, options));
  return applyOutputAssetLocks([...tokenCandidates, ...nativeCandidates].sort((left, right) => {
    if (left.status !== right.status) return left.status === "candidate" ? -1 : 1;
    return (right.sourceEstimatedUsd ?? -1) - (left.sourceEstimatedUsd ?? -1);
  }));
}

export function applyOutputAssetLocks(candidates = []) {
  const seen = new Set();
  return candidates.map((candidate) => {
    if (candidate.status !== "candidate") return candidate;
    const key = `${candidate.chain}:${normalizeToken(candidate.outputToken)}`;
    if (seen.has(key)) {
      return {
        ...candidate,
        status: "blocked",
        blockedReason: "output_asset_already_touched_in_run",
      };
    }
    seen.add(key);
    return candidate;
  });
}

function statePath(dataDir = config.dataDir) {
  return join(dataDir, "live-canary-sweep-state.json");
}

function nowMs(value) {
  const ms = new Date(value || Date.now()).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

function isoAfter(base, deltaMs) {
  return new Date(nowMs(base) + Math.max(0, Number(deltaMs) || 0)).toISOString();
}

function outputAssetKey(candidate = {}) {
  if (!candidate?.chain || !candidate?.outputToken) return null;
  return `${candidate.chain}:${normalizeToken(candidate.outputToken)}`;
}

export async function readLiveCanarySweepState({ dataDir = config.dataDir, state = null } = {}) {
  if (state && typeof state === "object") return state;
  try {
    const parsed = JSON.parse(await readFile(statePath(dataDir), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export async function writeLiveCanarySweepState({ state, dataDir = config.dataDir } = {}) {
  const nextState = {
    schemaVersion: 1,
    ...(state || {}),
  };
  await writeTextIfChanged(statePath(dataDir), `${safeJsonStringify(nextState, 2)}\n`);
  return nextState;
}

function activeUntil(value, now) {
  const untilMs = new Date(value || 0).getTime();
  return Number.isFinite(untilMs) && untilMs > nowMs(now);
}

export function applyPersistentSweepState(candidates = [], state = {}, { now = new Date().toISOString() } = {}) {
  const quarantinedChains = state?.quarantinedChains || {};
  const outputCooldowns = state?.outputAssetCooldowns || {};
  return candidates.map((candidate) => {
    if (candidate.status !== "candidate") return candidate;
    const quarantine = quarantinedChains[candidate.chain];
    if (activeUntil(quarantine?.until, now)) {
      return {
        ...candidate,
        status: "blocked",
        blockedReason: "chain_quarantined_after_uncertain_receipt",
        quarantine,
      };
    }
    const outputKey = outputAssetKey(candidate);
    const cooldown = outputKey ? outputCooldowns[outputKey] : null;
    if (activeUntil(cooldown?.until, now)) {
      return {
        ...candidate,
        status: "blocked",
        blockedReason: "output_asset_cooldown_active",
        cooldown,
      };
    }
    return candidate;
  });
}

function summarizePlan(plan = null) {
  if (!plan) return null;
  return {
    strategyId: plan.strategyId || null,
    planStatus: plan.planStatus || null,
    blockedReason: plan.blockedReason || null,
    chain: plan.chain || null,
    inputToken: plan.inputToken || null,
    outputToken: plan.outputToken || null,
    amount: plan.amount || null,
    amountUsd: plan.amountUsd ?? null,
    minimumOutputAmount: plan.minimumOutputAmount || null,
    steps: (plan.steps || []).map((step) => step.id),
    gasSnapshotError: plan.gasSnapshotError || null,
    provider: plan.quote?.provider || plan.quote?.source || null,
  };
}

function summarizeExecution(execution = null, error = null) {
  if (!execution && !error) return null;
  const stepResults = execution?.stepResults || [];
  return {
    settlementStatus: execution?.settlementStatus || (error ? "failed" : null),
    lastTxHash: stepResults.at(-1)?.signerResult?.broadcast?.txHash || null,
    stepResults: stepResults.map((step) => ({
      id: step.id,
      status: step.signerResult?.status || null,
      blockers: step.signerResult?.lifecycle?.blockers || step.signerResult?.policy?.blockers || [],
      txHash: step.signerResult?.broadcast?.txHash || null,
    })),
    destinationProof: execution?.destinationProof
      ? {
          status: execution.destinationProof.status || null,
          proofSource: execution.destinationProof.proofSource || null,
          observedDelta: execution.destinationProof.observedDelta || null,
          requiredDelta: execution.destinationProof.requiredDelta || null,
        }
      : null,
    receiptIngest: execution?.receiptIngest
      ? {
          appended: execution.receiptIngest.appended ?? null,
          reason: execution.receiptIngest.reason || null,
        }
      : null,
    error: error
      ? {
          name: error.name || "ExecutionError",
          message: error.message,
        }
      : execution?.error || null,
  };
}

function signerBlockersFromExecution(execution = null) {
  return (execution?.stepResults || [])
    .flatMap((step) => [
      ...(step?.signerResult?.lifecycle?.blockers || []),
      ...(step?.signerResult?.policy?.blockers || []),
    ])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function classifyExecutionError(error = null) {
  const signerBlockers = signerBlockersFromExecution(error?.partialExecution);
  if (signerBlockers.includes("max_consecutive_failures_reached")) {
    return {
      blockedReason: "max_consecutive_failures_reached",
      quarantineChain: false,
      shouldStopGlobally: false,
    };
  }

  const text = `${error?.name || ""} ${error?.message || ""}`.toLowerCase();
  if (/timeout|timed out|nonce|receipt|replacement|underpriced/u.test(text)) {
    return {
      blockedReason: "chain_quarantine_after_receipt_uncertainty",
      quarantineChain: true,
      shouldStopGlobally: false,
    };
  }
  if (/policy|reject|socket|eperm|econnrefused|signer/u.test(text)) {
    return {
      blockedReason: "global_safety_stop_after_execution_error",
      quarantineChain: false,
      shouldStopGlobally: true,
    };
  }
  return {
    blockedReason: "execution_error",
    quarantineChain: false,
    shouldStopGlobally: false,
  };
}

function countsTowardExecutionLimit(result = {}) {
  if (!result || result.status === "blocked") return false;
  if (result.status === "preview_ready" || result.status === "execution_failed") return true;
  return Boolean(result.execution?.lastTxHash || result.plan?.planStatus === "ready");
}

function normalizeOptionalCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function countBudgetReached(count, limit) {
  return Number.isFinite(limit) && count >= limit;
}

function txHashesFromExecution(execution = null) {
  return [...new Set([
    execution?.lastTxHash,
    ...(execution?.stepResults || []).map((step) => step.txHash),
  ].filter(Boolean).map(String))];
}

function auditRecordTimestampMs(record = {}) {
  const parsed = new Date(record.timestamp || record.observedAt || record.createdAt || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function txHashesFromAuditRecord(record = {}) {
  return [...new Set([
    record.broadcast?.txHash,
    record.lifecycle?.txHash,
    record.lifecycle?.broadcast?.txHash,
    record.realized?.transactionHash,
    record.txHash,
  ].filter(Boolean).map(String))];
}

function countRecentSignerBroadcasts(records = [], {
  now = new Date().toISOString(),
  windowMs = 10 * 60_000,
} = {}) {
  const cutoffMs = nowMs(now) - Math.max(0, Number(windowMs) || 0);
  const txHashes = new Set();
  for (const record of records || []) {
    const timestamp = auditRecordTimestampMs(record);
    if (!Number.isFinite(timestamp) || timestamp < cutoffMs) continue;
    const isBroadcast =
      Boolean(record?.broadcast?.txHash) ||
      record?.lifecycle?.stage === "broadcasted" ||
      record?.lifecycle?.stage === "confirmed";
    if (!isBroadcast) continue;
    for (const txHash of txHashesFromAuditRecord(record)) txHashes.add(txHash);
  }
  return txHashes.size;
}

async function buildExecutionBudget({
  execute = false,
  readSignerAuditLogImpl = readSignerAuditLog,
  maxExecutedCandidates = null,
  maxBroadcastSteps = null,
  maxRecentBroadcasts = null,
  recentBroadcastWindowMs = 10 * 60_000,
  now = new Date().toISOString(),
} = {}) {
  const budget = {
    allowed: true,
    blockedReason: null,
    blockers: [],
    executedCandidateCount: 0,
    broadcastStepCount: 0,
    recentBroadcastCount: 0,
    maxExecutedCandidates: normalizeOptionalCount(maxExecutedCandidates),
    maxBroadcastSteps: normalizeOptionalCount(maxBroadcastSteps),
    maxRecentBroadcasts: normalizeOptionalCount(maxRecentBroadcasts),
    recentBroadcastWindowMs: Math.max(0, Number(recentBroadcastWindowMs) || 0),
  };
  if (!execute) return budget;

  if (Number.isFinite(budget.maxRecentBroadcasts)) {
    const records = await readSignerAuditLogImpl();
    budget.recentBroadcastCount = countRecentSignerBroadcasts(records, {
      now,
      windowMs: budget.recentBroadcastWindowMs,
    });
    if (countBudgetReached(budget.recentBroadcastCount, budget.maxRecentBroadcasts)) {
      budget.allowed = false;
      budget.blockedReason = "recent_tx_budget_exhausted";
      budget.blockers.push("recent_tx_budget_exhausted");
    }
  }
  return budget;
}

function localExecutionBudgetBlocker(budget = {}) {
  if (budget.blockers?.includes("max_broadcast_steps_reached")) {
    return "max_broadcast_steps_reached";
  }
  if (countBudgetReached(budget.executedCandidateCount, budget.maxExecutedCandidates)) {
    return "max_executed_candidates_reached";
  }
  if (countBudgetReached(budget.broadcastStepCount, budget.maxBroadcastSteps)) {
    return "max_broadcast_steps_reached";
  }
  return null;
}

async function evaluateCandidate({
  candidate,
  senderAddress,
  execute = false,
  socketPath,
  timeoutMs,
  buildTokenDexPlanImpl = buildTokenDexExperimentPlan,
  buildNativeDexPlanImpl = buildNativeDexExperimentPlan,
  executeTokenDexPlanImpl = executeTokenDexExperimentPlan,
  executeNativeDexPlanImpl = executeNativeDexExperimentPlan,
  remainingBroadcastSteps = null,
} = {}) {
  if (candidate.status !== "candidate") {
    return {
      candidate,
      status: "blocked",
      blockedReason: candidate.blockedReason || "candidate_blocked",
      plan: null,
      execution: null,
      shouldStopGlobally: false,
    };
  }

  let plan = null;
  try {
    plan = candidate.kind === "native_dex"
      ? await buildNativeDexPlanImpl({
          chain: candidate.chain,
          amount: candidate.amount,
          senderAddress,
          outputToken: candidate.outputToken,
        })
      : await buildTokenDexPlanImpl({
          chain: candidate.chain,
          amount: candidate.amount,
          senderAddress,
          inputToken: candidate.inputToken,
          outputToken: candidate.outputToken,
        });
  } catch (error) {
    return {
      candidate,
      status: "blocked",
      blockedReason: "plan_build_failed",
      plan: null,
      execution: null,
      error: { name: error.name || "PlanBuildFailed", message: error.message },
      shouldStopGlobally: false,
    };
  }

  if (plan.planStatus !== "ready") {
    return {
      candidate,
      status: "blocked",
      blockedReason: plan.blockedReason || "plan_blocked",
      plan: summarizePlan(plan),
      execution: null,
      shouldStopGlobally: false,
    };
  }
  if (!execute) {
    return {
      candidate,
      status: "preview_ready",
      blockedReason: null,
      plan: summarizePlan(plan),
      execution: null,
      shouldStopGlobally: false,
    };
  }
  const planBroadcastSteps = (plan.steps || []).length;
  if (Number.isFinite(remainingBroadcastSteps) && planBroadcastSteps > remainingBroadcastSteps) {
    return {
      candidate,
      status: "not_run_execution_budget_reached",
      blockedReason: "execution_budget_reached",
      executionBudgetBlocker: "max_broadcast_steps_reached",
      plan: summarizePlan(plan),
      execution: null,
      shouldStopGlobally: false,
    };
  }

  try {
    const execution = candidate.kind === "native_dex"
      ? await executeNativeDexPlanImpl({ plan, socketPath, timeoutMs })
      : await executeTokenDexPlanImpl({ plan, socketPath, timeoutMs });
    return {
      candidate,
      status: execution?.settlementStatus || "source_confirmed_only",
      blockedReason: null,
      plan: summarizePlan(plan),
      execution: summarizeExecution(execution),
      shouldStopGlobally: false,
    };
  } catch (error) {
    const partialExecution = error.partialExecution || null;
    const classification = classifyExecutionError(error);
    return {
      candidate,
      status: "execution_failed",
      blockedReason: classification.blockedReason,
      plan: summarizePlan(plan),
      execution: summarizeExecution(partialExecution, error),
      shouldStopGlobally: classification.shouldStopGlobally,
      quarantineChain: classification.quarantineChain ? candidate.chain : null,
    };
  }
}

export async function preflightLiveCanarySweep({
  dataDir = config.dataDir,
  killSwitchPath = process.env.KILL_SWITCH_PATH || config.emergencyStopFlagPath,
  socketPath = signerSocketPath(),
  timeoutMs = signerClientTimeoutMs(),
  readSignerHealthImpl = readSignerHealth,
  buildDashboardContextImpl = DEFAULT_DASHBOARD_CONTEXT_IMPL,
  readLiveBaselineImpl = null,
  killSwitchExistsImpl = existsSync,
  requireLiveBaseline = true,
} = {}) {
  if (killSwitchPath && killSwitchExistsImpl(killSwitchPath)) {
    return {
      status: "blocked",
      blockedReason: "kill_switch_present",
      killSwitchPath,
    };
  }

  let signerHealth = null;
  try {
    signerHealth = await readSignerHealthImpl({ socketPath, timeoutMs });
  } catch (error) {
    return {
      status: "blocked",
      blockedReason: "signer_health_unreachable",
      error: { name: error.name || "SignerHealthError", message: error.message },
      killSwitchPath,
    };
  }
  const senderAddress = signerHealth?.addresses?.base || signerHealth?.addresses?.evm || null;
  if (!senderAddress) {
    return {
      status: "blocked",
      blockedReason: "signer_evm_address_missing",
      signerHealth,
      killSwitchPath,
    };
  }

  let liveBaseline = null;
  if (requireLiveBaseline) {
    if (readLiveBaselineImpl) {
      liveBaseline = await readLiveBaselineImpl({ dataDir });
    } else if (buildDashboardContextImpl !== DEFAULT_DASHBOARD_CONTEXT_IMPL) {
      const context = await buildDashboardContextImpl({ dataDir });
      liveBaseline = context?.dashboardStatus?.liveBaseline || null;
    } else {
      liveBaseline = await readCachedLiveBaseline({ dataDir });
    }
  }
  if (requireLiveBaseline && liveBaseline?.status !== "ready") {
    return {
      status: "blocked",
      blockedReason: "live_baseline_blocked",
      signerHealth,
      senderAddress,
      liveBaseline,
      killSwitchPath,
    };
  }

  return {
    status: "ready",
    blockedReason: null,
    signerHealth,
    senderAddress,
    bitcoinAddress: signerHealth?.addresses?.bitcoin || null,
    liveBaseline,
    killSwitchPath,
  };
}

async function scanInventoryForSweep({ senderAddress, bitcoinAddress, families = null, scanInventoryImpl = scanWholeWalletInventory } = {}) {
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const prices = await getCoinGeckoPricesUsd().catch(() => emptyPricesUsd());
  return scanInventoryImpl({
    address: senderAddress,
    bitcoinAddress,
    prices,
    chains: policy.supportedChains,
    families,
  });
}

export async function readCachedLiveBaseline({ dataDir = config.dataDir } = {}) {
  try {
    const dashboardStatus = JSON.parse(await readFile(join(dataDir, "dashboard-status.json"), "utf8"));
    return dashboardStatus?.liveBaseline || null;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function runLiveCanarySweep({
  execute = false,
  write = false,
  dataDir = config.dataDir,
  chains = null,
  excludeChains = [],
  limit = 8,
  tinyUsd = DEFAULT_TINY_USD,
  nativeTinyUsd = DEFAULT_TINY_USD,
  minHoldingUsd = DEFAULT_MIN_HOLDING_USD,
  chainQuarantineMs = DEFAULT_CHAIN_QUARANTINE_MS,
  outputAssetCooldownMs = DEFAULT_OUTPUT_ASSET_COOLDOWN_MS,
  socketPath = signerSocketPath(),
  timeoutMs = signerClientTimeoutMs(),
  inventory = null,
  state = null,
  readStateImpl = readLiveCanarySweepState,
  writeStateImpl = writeLiveCanarySweepState,
  readSignerAuditLogImpl = readSignerAuditLog,
  preflightImpl = preflightLiveCanarySweep,
  scanInventoryImpl = scanWholeWalletInventory,
  buildTokenDexPlanImpl = buildTokenDexExperimentPlan,
  buildNativeDexPlanImpl = buildNativeDexExperimentPlan,
  executeTokenDexPlanImpl = executeTokenDexExperimentPlan,
  executeNativeDexPlanImpl = executeNativeDexExperimentPlan,
  maxExecutedCandidates = null,
  maxBroadcastSteps = null,
  maxRecentBroadcasts = null,
  recentBroadcastWindowMs = 10 * 60_000,
  now = new Date().toISOString(),
} = {}) {
  const preflight = await preflightImpl({ dataDir, socketPath, timeoutMs });
  if (preflight.status !== "ready") {
    const report = {
      schemaVersion: 1,
      observedAt: now,
      mode: execute ? "execute" : "preview",
      status: "blocked",
      blockedReason: preflight.blockedReason,
      preflight,
      inventory: null,
      candidates: [],
      results: [],
      summary: {
        candidateCount: 0,
        previewReadyCount: 0,
        executedCount: 0,
        deliveredCount: 0,
        blockedCount: 0,
        globalStopReason: preflight.blockedReason,
      },
    };
    if (write) await writeLiveCanarySweepReport({ report, dataDir });
    return report;
  }

  const resolvedInventory = inventory || await scanInventoryForSweep({
    senderAddress: preflight.senderAddress,
    bitcoinAddress: preflight.bitcoinAddress,
    scanInventoryImpl,
  });
  const persistedState = await readStateImpl({ dataDir, state });
  const candidates = applyPersistentSweepState(buildLiveCanaryCandidates({
    inventory: resolvedInventory,
    chains,
    excludeChains,
    tinyUsd,
    nativeTinyUsd,
    minHoldingUsd,
  }), persistedState, { now });
  const executionBudget = await buildExecutionBudget({
    execute,
    readSignerAuditLogImpl,
    maxExecutedCandidates,
    maxBroadcastSteps,
    maxRecentBroadcasts,
    recentBroadcastWindowMs,
    now,
  });

  const results = [];
  let executableSeen = 0;
  let globalStopReason = null;
  for (const candidate of candidates) {
    if (globalStopReason) {
      results.push({
        candidate,
        status: "not_run_global_stop",
        blockedReason: globalStopReason,
        plan: null,
        execution: null,
        shouldStopGlobally: false,
      });
      continue;
    }
    if (execute && candidate.status === "candidate" && !executionBudget.allowed) {
      results.push({
        candidate,
        status: "not_run_recent_tx_budget_exhausted",
        blockedReason: executionBudget.blockedReason || "recent_tx_budget_exhausted",
        plan: null,
        execution: null,
        shouldStopGlobally: false,
      });
      continue;
    }
    const budgetBlocker = execute && candidate.status === "candidate"
      ? localExecutionBudgetBlocker(executionBudget)
      : null;
    if (budgetBlocker) {
      executionBudget.blockedReason ||= budgetBlocker;
      if (!executionBudget.blockers.includes(budgetBlocker)) executionBudget.blockers.push(budgetBlocker);
      results.push({
        candidate,
        status: "not_run_execution_budget_reached",
        blockedReason: "execution_budget_reached",
        executionBudgetBlocker: budgetBlocker,
        plan: null,
        execution: null,
        shouldStopGlobally: false,
      });
      continue;
    }
    if (candidate.status === "candidate" && executableSeen >= limit) {
      results.push({
        candidate,
        status: "not_run_limit_reached",
        blockedReason: "limit_reached",
        plan: null,
        execution: null,
        shouldStopGlobally: false,
      });
      continue;
    }
    const result = await evaluateCandidate({
      candidate,
      senderAddress: preflight.senderAddress,
      execute,
      socketPath,
      timeoutMs,
      buildTokenDexPlanImpl,
      buildNativeDexPlanImpl,
      executeTokenDexPlanImpl,
      executeNativeDexPlanImpl,
      remainingBroadcastSteps: Number.isFinite(executionBudget.maxBroadcastSteps)
        ? Math.max(0, executionBudget.maxBroadcastSteps - executionBudget.broadcastStepCount)
        : null,
    });
    results.push(result);
    if (execute && result.executionBudgetBlocker) {
      executionBudget.blockedReason ||= result.executionBudgetBlocker;
      if (!executionBudget.blockers.includes(result.executionBudgetBlocker)) {
        executionBudget.blockers.push(result.executionBudgetBlocker);
      }
    }
    const txHashes = txHashesFromExecution(result.execution);
    if (execute && txHashes.length > 0) {
      executionBudget.executedCandidateCount += 1;
      executionBudget.broadcastStepCount += txHashes.length;
    }
    if (candidate.status === "candidate" && countsTowardExecutionLimit(result)) {
      executableSeen += 1;
    }
    if (result.shouldStopGlobally) {
      globalStopReason = result.blockedReason || "global_safety_stop";
    }
  }

  const nextState = updateLiveCanarySweepStateFromResults({
    state: persistedState,
    results,
    now,
    chainQuarantineMs,
    outputAssetCooldownMs,
  });

  const report = {
    schemaVersion: 1,
    observedAt: now,
    mode: execute ? "execute" : "preview",
    status: globalStopReason ? "stopped" : "completed",
    blockedReason: globalStopReason,
    preflight: {
      status: preflight.status,
      senderAddress: preflight.senderAddress,
      bitcoinAddress: preflight.bitcoinAddress,
      liveBaseline: preflight.liveBaseline,
      killSwitchPath: preflight.killSwitchPath,
    },
    inventory: {
      observedAt: resolvedInventory?.observedAt || null,
      totalUsd: resolvedInventory?.totalUsd ?? null,
      nativeCount: resolvedInventory?.summary?.nativeCount ?? 0,
      tokenCount: resolvedInventory?.summary?.tokenCount ?? 0,
      scanErrorCount: resolvedInventory?.summary?.scanErrorCount ?? 0,
      scanErrors: resolvedInventory?.scanErrors || [],
    },
    candidates,
    results,
    state: nextState,
    summary: {
      candidateCount: candidates.length,
      previewReadyCount: results.filter((item) => item.status === "preview_ready").length,
      executedCount: results.filter((item) => item.execution?.lastTxHash).length,
      deliveredCount: results.filter((item) => item.status === "delivered").length,
      blockedCount: results.filter((item) => item.status === "blocked").length,
      quarantinedCount: results.filter((item) => item.quarantineChain).length,
      executedCandidateCount: executionBudget.executedCandidateCount,
      broadcastStepCount: executionBudget.broadcastStepCount,
      executionBudget,
      globalStopReason,
    },
  };
  if (write) {
    await writeLiveCanarySweepReport({ report, dataDir });
    await writeStateImpl({ state: nextState, dataDir });
  }
  return report;
}

export function updateLiveCanarySweepStateFromResults({
  state = {},
  results = [],
  now = new Date().toISOString(),
  chainQuarantineMs = DEFAULT_CHAIN_QUARANTINE_MS,
  outputAssetCooldownMs = DEFAULT_OUTPUT_ASSET_COOLDOWN_MS,
} = {}) {
  const next = {
    schemaVersion: 1,
    updatedAt: now,
    quarantinedChains: { ...(state?.quarantinedChains || {}) },
    outputAssetCooldowns: { ...(state?.outputAssetCooldowns || {}) },
  };

  for (const result of results || []) {
    const chain = result?.quarantineChain || null;
    if (chain) {
      next.quarantinedChains[chain] = {
        reason: result.blockedReason || "receipt_uncertain",
        until: isoAfter(now, chainQuarantineMs),
        lastCandidateId: result.candidate?.id || null,
        lastTxHash: result.execution?.lastTxHash || null,
      };
      continue;
    }
    const key = outputAssetKey(result?.candidate);
    if (!key) continue;
    if (result?.execution?.lastTxHash || result?.status === "delivered" || result?.status === "source_confirmed_only") {
      next.outputAssetCooldowns[key] = {
        reason: "output_asset_touched",
        until: isoAfter(now, outputAssetCooldownMs),
        lastCandidateId: result.candidate?.id || null,
        lastTxHash: result.execution?.lastTxHash || null,
      };
    }
  }

  for (const [chain, value] of Object.entries(next.quarantinedChains)) {
    if (!activeUntil(value?.until, now)) delete next.quarantinedChains[chain];
  }
  for (const [key, value] of Object.entries(next.outputAssetCooldowns)) {
    if (!activeUntil(value?.until, now)) delete next.outputAssetCooldowns[key];
  }
  return next;
}

export async function writeLiveCanarySweepReport({ report, dataDir = config.dataDir } = {}) {
  const outputPath = join(dataDir, "live-canary-sweep-latest.json");
  await writeTextIfChanged(outputPath, `${safeJsonStringify(report, 2)}\n`);
  await new JsonlStore(dataDir).append("live-canary-sweeps", report);
  return outputPath;
}
