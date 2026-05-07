import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tokenAsset, ZERO_TOKEN } from "../assets/tokens.mjs";
import { evaluateMerklAutoEntry } from "../config/merkl-auto-entry.mjs";
import { config } from "../config/env.mjs";
import { getStrategyCaps, resolveStrategyCapMatrix, validateStrategyCapsConfig } from "../config/strategy-caps.mjs";
import { evaluateCapCheck } from "./policy/cap-check.mjs";
import { evaluateCanaryGraduation } from "./canary/canary-graduation.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { SMALL_CAPITAL_CAMPAIGN_MODE } from "../config/small-capital-campaign-mode.mjs";
import {
  computeTinyCanaryMinProfitablePositionUsd,
  resolveTinyCanaryExpectedHoldDays,
} from "../config/sizing.mjs";
import { preflightLiveCanarySweep } from "./live-canary-sweep.mjs";
import { readErc20Balance, readNativeBalance } from "../evm/account-state.mjs";
import {
  applyMerklCanaryExecutionReadiness,
  latestTreasuryInventoryForAddress,
} from "../strategy/merkl-canary-execution-readiness.mjs";
import {
  isSupportedBindingKind,
  resolveIntentType,
  resolvePlanBuilder,
  resolvePlanExecutor,
} from "./protocol-binding-registry.mjs";
import { evaluateOpportunityPolicy } from "./policy/opportunity-policy.mjs";


const DEFAULT_MIN_ETHEREUM_NOTIONAL_USD = 25;

function finite(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function decimalsForQueueItem(queueItem = {}) {
  const binding = queueItem.protocolBindingPlan?.resolvedBinding || {};
  if (Number.isInteger(binding.assetDecimals)) return binding.assetDecimals;
  const assetAddress = binding.assetAddress;
  if (!assetAddress) return 6;
  return tokenAsset(queueItem.chain, assetAddress).decimals;
}

function decimalUsdToMicros(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0n;
  return BigInt(Math.floor(parsed * 1_000_000));
}

function unitsFromUsdByInventory({ balanceUnits, balanceUsd, targetUsd }) {
  const balance = BigInt(balanceUnits || 0);
  if (balance <= 0n) return 0n;
  const targetMicros = decimalUsdToMicros(targetUsd);
  const balanceMicros = decimalUsdToMicros(balanceUsd);
  if (targetMicros <= 0n) return 0n;
  if (balanceMicros <= 0n) return balance;
  const amount = (balance * targetMicros) / balanceMicros;
  if (amount <= 0n) return 0n;
  return amount > balance ? balance : amount;
}

function usdFromUnitsByInventory({ amountUnits, balanceUnits, balanceUsd }) {
  const amount = BigInt(amountUnits || 0);
  const balance = BigInt(balanceUnits || 0);
  const balanceMicros = decimalUsdToMicros(balanceUsd);
  if (amount <= 0n || balance <= 0n || balanceMicros <= 0n) return 0;
  return Number((amount * balanceMicros) / balance) / 1_000_000;
}

function bindingKind(queueItem = {}) {
  return queueItem.protocolBindingPlan?.bindingKind || null;
}

function displayedAprPct(queueItem = {}) {
  return finite(
    queueItem.effectiveAprPct ??
      queueItem.displayedAprPct ??
      queueItem.aprPct ??
      queueItem.apr ??
      queueItem.apy,
  );
}

function evLimitingFactor({ queueItem = {}, sizing = {}, neededUsd = null } = {}) {
  const inventoryUsd = finite(queueItem.executionReadiness?.matchedToken?.estimatedUsd);
  const capUsd = finite(sizing.capUsd);
  const currentUsd = finite(sizing.amountUsd);
  if (inventoryUsd !== null && currentUsd !== null && Math.abs(inventoryUsd - currentUsd) < 0.000001) return "inventory";
  if (inventoryUsd !== null && neededUsd !== null && inventoryUsd < neededUsd) return "inventory";
  if (capUsd !== null && neededUsd !== null && capUsd < neededUsd) return "cap";
  return "unknown";
}

function tinyCanaryEvGate(queueItem = {}, sizing = {}, { now = new Date().toISOString() } = {}) {
  if (sizing.status !== "ready") return null;
  const srcChain = queueItem.srcChain || queueItem.chain || null;
  const dstChain = queueItem.dstChain || queueItem.chain || null;
  if (!srcChain || !dstChain || srcChain !== dstChain) return null;
  const holdDays = resolveTinyCanaryExpectedHoldDays({
    expectedHoldDays: queueItem.expectedHoldDays,
    campaignRemainingHours: queueItem.campaignRemainingHours,
    campaignEndsAt: queueItem.campaignEndsAt,
    now,
  });
  const neededUsd = computeTinyCanaryMinProfitablePositionUsd({
    chain: srcChain,
    aprPct: displayedAprPct(queueItem),
    expectedHoldDays: holdDays,
    estimatedGasCostUsd: queueItem.estimatedGasCostUsd,
  });
  const currentAmountUsd = finite(sizing.amountUsd);
  if (neededUsd === null || currentAmountUsd === null) return null;
  if (currentAmountUsd >= neededUsd) {
    return {
      status: "ready",
      blocker: null,
      currentAmountUsd,
      neededUsd,
      holdDays,
      limitingFactor: null,
    };
  }
  return {
    status: "blocked",
    blocker: `same_chain_unprofitable:need_$${Math.ceil(neededUsd)}_on_${srcChain}`,
    currentAmountUsd,
    neededUsd,
    holdDays,
    limitingFactor: evLimitingFactor({ queueItem, sizing, neededUsd }),
  };
}

export function sizeMerklCanaryAmount(queueItem = {}, {
  maxUsd = null,
  minEthereumNotionalUsd = DEFAULT_MIN_ETHEREUM_NOTIONAL_USD,
  allowInefficientEthereum = false,
  useTinyLiveCap = true,
  useGraduationCap = useTinyLiveCap,
  canaryExecutions = [],
  canaryGraduationPolicy = SMALL_CAPITAL_CAMPAIGN_MODE.canaryGraduation,
  auditRecords = [],
  now = new Date().toISOString(),
} = {}) {
  const readiness = queueItem.executionReadiness || {};
  const matchedToken = readiness.matchedToken || null;
  const strategyId = queueItem.mappedStrategyId;
  const strategyCaps = getStrategyCaps(strategyId);
  const validation = strategyCaps ? validateStrategyCapsConfig(strategyCaps) : { ok: false, errors: ["missing_strategy_caps"] };
  if (!strategyCaps || !validation.ok) {
    return {
      status: "blocked",
      blockers: !strategyCaps ? ["missing_strategy_caps"] : validation.errors,
      strategyId,
      capUsd: null,
      amount: null,
      amountUsd: null,
      decimals: decimalsForQueueItem(queueItem),
      graduation: null,
    };
  }
  const resolvedCapMatrix = resolveStrategyCapMatrix(strategyCaps);
  const tinyCapUsd = finite(resolvedCapMatrix?.tinyLivePerTxUsd);
  const chainCapUsd = finite(resolvedCapMatrix?.perChainUsd?.[queueItem.chain]);
  const graduation = useGraduationCap
    ? evaluateCanaryGraduation({
        queueItem,
        canaryExecutions,
        auditRecords,
        policy: canaryGraduationPolicy,
        now,
      })
    : null;
  const graduationCapUsd = graduation?.status === "ready" ? finite(graduation.targetUsd) : null;
  const canaryCapUsd = useGraduationCap
    ? graduationCapUsd
    : useTinyLiveCap
      ? tinyCapUsd
      : finite(strategyCaps.caps.perTxUsd);
  const hardCapUsd = Math.min(
    canaryCapUsd ?? Number.NaN,
    chainCapUsd ?? Number.POSITIVE_INFINITY,
    useTinyLiveCap ? (tinyCapUsd ?? Number.NaN) : Number.POSITIVE_INFINITY,
    finite(maxUsd) ?? Number.POSITIVE_INFINITY,
    finite(matchedToken?.estimatedUsd) ?? Number.POSITIVE_INFINITY,
  );

  const blockers = [];
  if (useTinyLiveCap && tinyCapUsd === null) blockers.push("strategy_tiny_live_cap_missing");
  if (useGraduationCap && graduation?.status === "blocked") blockers.push(...graduation.blockers);
  if (useGraduationCap && graduation?.status === "disabled") blockers.push(...graduation.blockers);
  if (useGraduationCap && graduationCapUsd === null) blockers.push("canary_graduation_cap_unavailable");
  if (!isSupportedBindingKind(bindingKind(queueItem))) blockers.push("unsupported_binding_kind");
  if (readiness.status !== "inventory_ready") blockers.push(readiness.status || "inventory_not_ready");
  if (!matchedToken?.actual) blockers.push("matched_token_missing");
  if (!Number.isFinite(hardCapUsd) || hardCapUsd <= 0) blockers.push("no_positive_cap_or_inventory_usd");
  if (
    queueItem.chain === "ethereum" &&
    !allowInefficientEthereum &&
    hardCapUsd < minEthereumNotionalUsd
  ) {
    blockers.push("cap_too_low_for_ethereum_gas_efficiency");
  }
  if (strategyCaps && validation.ok && Number.isFinite(hardCapUsd) && hardCapUsd > 0) {
    const capCheck = evaluateCapCheck({
      intent: {
        strategyId,
        chain: queueItem.chain,
        intentType: resolveIntentType(bindingKind(queueItem)) || "erc4626_deposit",
        amountUsd: hardCapUsd,
        mode: "live",
        executionReason: "strategy_execution",
        metadata: {
          capCheckAmountUsd: hardCapUsd,
        },
      },
      strategyCaps,
      auditRecords,
      now,
    });
    blockers.push(...capCheck.blockers);
  }

  if (blockers.length) {
    return {
      status: "blocked",
      blockers,
      strategyId,
      capUsd: Number.isFinite(hardCapUsd) ? hardCapUsd : null,
      amount: null,
      amountUsd: null,
      decimals: decimalsForQueueItem(queueItem),
      graduation,
    };
  }

  const amountUnits = unitsFromUsdByInventory({
    balanceUnits: matchedToken.actual,
    balanceUsd: matchedToken.estimatedUsd,
    targetUsd: hardCapUsd,
  });
  if (amountUnits <= 0n) {
    return {
      status: "blocked",
      blockers: ["amount_too_small_after_sizing"],
      strategyId,
      capUsd: hardCapUsd,
      amount: null,
      amountUsd: null,
      decimals: decimalsForQueueItem(queueItem),
      graduation,
    };
  }

  return {
    status: "ready",
    blockers: [],
    strategyId,
    capUsd: hardCapUsd,
    amount: amountUnits.toString(),
    amountUsd: usdFromUnitsByInventory({
      amountUnits,
      balanceUnits: matchedToken.actual,
      balanceUsd: matchedToken.estimatedUsd,
    }),
    decimals: decimalsForQueueItem(queueItem),
    graduation,
  };
}

export function selectMerklCanaryAutopilotCandidate(queue = {}, options = {}) {
  const selection = selectMerklCanaryAutopilotCandidates(queue, { ...options, maxCandidates: 1 });
  return {
    selected: selection.selected[0] || null,
    readyCount: selection.readyCount,
    candidates: selection.candidates,
  };
}

function graduationRequestByOpportunity(requests = []) {
  const byOpportunity = new Map();
  for (const request of requests || []) {
    const opportunityId = request?.opportunityId;
    if (!opportunityId) continue;
    byOpportunity.set(String(opportunityId), request);
  }
  return byOpportunity;
}

function portfolioGraduationPriority(queueItem = {}) {
  return queueItem.metadata?.portfolioGraduationRequest ? 1 : 0;
}

function matchingPortfolioGraduationRequest(queueItem = {}, requestsByOpportunity = new Map()) {
  const request = requestsByOpportunity.get(String(queueItem.opportunityId || ""));
  if (!request) return null;
  if (request.chain && request.chain !== queueItem.chain) return null;
  if (request.strategyId && request.strategyId !== queueItem.mappedStrategyId) return null;
  return request;
}

export function selectMerklCanaryAutopilotCandidates(queue = {}, options = {}) {
  const portfolioGraduationRequests = graduationRequestByOpportunity(options.graduationCanaryRequests);
  const candidates = (queue.queue || [])
    .map((queueItem) => {
      const refreshedItem = options.inventorySnapshot || options.canaryExecutions
        ? applyMerklCanaryExecutionReadiness(queueItem, {
            inventorySnapshot: options.inventorySnapshot,
            canaryExecutions: options.canaryExecutions,
            now: options.now || new Date().toISOString(),
          })
        : queueItem;
      const graduationRequest = matchingPortfolioGraduationRequest(refreshedItem, portfolioGraduationRequests);
      const hintedItem = graduationRequest
        ? {
            ...refreshedItem,
            metadata: {
              ...(refreshedItem.metadata || {}),
              portfolioGraduationRequest: graduationRequest,
            },
          }
        : refreshedItem;
      const autoEntry = evaluateMerklAutoEntry(refreshedItem, {
        bindingSupported: isSupportedBindingKind(bindingKind(refreshedItem)),
      });
      if (!autoEntry.autoExecute) {
        return {
          queueItem: { ...hintedItem, autoEntry },
          sizing: {
            status: "blocked",
            blockers: autoEntry.blockers,
            strategyId: refreshedItem.mappedStrategyId,
            capUsd: null,
            amount: null,
            amountUsd: null,
            decimals: decimalsForQueueItem(refreshedItem),
          },
        };
      }
      return {
        queueItem: { ...hintedItem, autoEntry },
        sizing: sizeMerklCanaryAmount(refreshedItem, options),
      };
    });
  const maxCandidates = Math.max(1, Number.isInteger(options.maxCandidates) ? options.maxCandidates : 6);
  const maxPerChain = Math.max(1, Number.isInteger(options.maxPerChain) ? options.maxPerChain : 3);
  const maxPerProtocol = Math.max(1, Number.isInteger(options.maxPerProtocol) ? options.maxPerProtocol : 4);
  const ready = candidates
    .filter((item) => item.sizing.status === "ready")
    .sort((left, right) => {
      const graduationDelta = portfolioGraduationPriority(right.queueItem) - portfolioGraduationPriority(left.queueItem);
      if (graduationDelta !== 0) return graduationDelta;
      if ((right.queueItem.priorityScore ?? 0) !== (left.queueItem.priorityScore ?? 0)) {
        return (right.queueItem.priorityScore ?? 0) - (left.queueItem.priorityScore ?? 0);
      }
      return (right.sizing.amountUsd ?? 0) - (left.sizing.amountUsd ?? 0);
    });
  const byChain = new Map();
  for (const candidate of ready) {
    const chain = candidate.queueItem.chain || "unknown";
    if (!byChain.has(chain)) byChain.set(chain, []);
    byChain.get(chain).push(candidate);
  }
  const chainOrder = [...byChain.keys()].sort((left, right) => {
    const leftTop = byChain.get(left)?.[0];
    const rightTop = byChain.get(right)?.[0];
    const graduationDelta = portfolioGraduationPriority(rightTop?.queueItem) - portfolioGraduationPriority(leftTop?.queueItem);
    if (graduationDelta !== 0) return graduationDelta;
    return (rightTop?.queueItem.priorityScore ?? 0) - (leftTop?.queueItem.priorityScore ?? 0);
  });
  const selected = [];
  const chainCounts = new Map();
  const protocolCounts = new Map();
  while (selected.length < maxCandidates) {
    const before = selected.length;
    for (const chain of chainOrder) {
      if (selected.length >= maxCandidates) break;
      if ((chainCounts.get(chain) || 0) >= maxPerChain) continue;
      const chainQueue = byChain.get(chain) || [];
      let candidate = null;
      while (chainQueue.length) {
        const next = chainQueue.shift();
        const protocol = `${chain}:${next.queueItem.protocolId || "unknown"}`;
        if ((protocolCounts.get(protocol) || 0) >= maxPerProtocol) continue;
        candidate = next;
        break;
      }
      if (!candidate) continue;
      const protocol = `${chain}:${candidate.queueItem.protocolId || "unknown"}`;
      selected.push(candidate);
      chainCounts.set(chain, (chainCounts.get(chain) || 0) + 1);
      protocolCounts.set(protocol, (protocolCounts.get(protocol) || 0) + 1);
    }
    if (selected.length === before) break;
  }
  return {
    selected,
    readyCount: ready.length,
    candidates,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonIfExists(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function portfolioGraduationRequestsFromReport(report = {}) {
  if (Array.isArray(report?.plan?.graduationCanaryRequests)) return report.plan.graduationCanaryRequests;
  if (Array.isArray(report?.graduationCanaryRequests)) return report.graduationCanaryRequests;
  if (Array.isArray(report?.allocator?.graduationCanaryRequests)) return report.allocator.graduationCanaryRequests;
  const topRequest = report?.allocator?.topGraduationCanaryRequest || null;
  return topRequest ? [topRequest] : [];
}

function dedupeGraduationRequests(requests = []) {
  const byOpportunity = new Map();
  for (const request of requests || []) {
    const opportunityId = request?.opportunityId;
    if (!opportunityId || byOpportunity.has(String(opportunityId))) continue;
    byOpportunity.set(String(opportunityId), request);
  }
  return [...byOpportunity.values()];
}

function compactCandidate(item) {
  return {
    opportunityId: item.queueItem?.opportunityId || null,
    chain: item.queueItem?.chain || null,
    protocolId: item.queueItem?.protocolId || null,
    bindingKind: bindingKind(item.queueItem),
    readiness: item.queueItem?.executionReadiness?.status || null,
    sizingStatus: item.sizing?.status || null,
    amount: item.sizing?.amount || null,
    amountUsd: item.sizing?.amountUsd ?? null,
    blockers: item.sizing?.blockers || [],
    graduation: item.sizing?.graduation || null,
  };
}

function compactRepresentativeCoverage(queue = {}) {
  return queue.representativeCoverage?.summary || queue.summary?.representativeCoverage || null;
}

function topCountKey(counts = {}) {
  const [top] = Object.entries(counts).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  });
  return top?.[0] || null;
}

function resultBlockers(result = {}) {
  if (result.status !== "blocked") return [];
  if (result.opportunityPolicy?.blockers?.length) return result.opportunityPolicy.blockers;
  if (result.execution?.error?.policy?.blockers?.length) return result.execution.error.policy.blockers;
  if (result.sizing?.blockers?.length) return result.sizing.blockers;
  if (result.blockedReason) return [result.blockedReason];
  return ["blocked"];
}

export function summarizeMerklAutopilotResults(results = []) {
  const blockerCounts = {};
  for (const result of results) {
    for (const blocker of resultBlockers(result)) {
      blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
    }
  }
  const blockedCount = results.filter((item) => item.status === "blocked").length;
  const previewReadyCount = results.filter((item) => item.status === "preview_ready").length;
  const deliveredCount = results.filter((item) => item.execution?.settlementStatus === "delivered").length;
  const topBlocker = topCountKey(blockerCounts);
  const evGateForTopBlocker =
    results.find((item) => item.opportunityPolicy?.evGate?.status === "blocked" && item.opportunityPolicy.evGate.blocker === topBlocker)
      ?.opportunityPolicy?.evGate || null;
  return {
    selectedCount: results.length,
    executionReadyCount: results.length - blockedCount,
    previewReadyCount,
    deliveredCount,
    blockedCount,
    blockerCounts,
    topBlocker,
    topEvGate: evGateForTopBlocker,
  };
}

function scaledUsdEstimate({ priorUnits, priorUsd, liveUnits }) {
  const priorAmount = BigInt(priorUnits || 0);
  const liveAmount = BigInt(liveUnits || 0);
  const priorEstimate = Number(priorUsd);
  if (liveAmount <= 0n || priorAmount <= 0n || !Number.isFinite(priorEstimate) || priorEstimate <= 0) return 0;
  return Number((liveAmount * decimalUsdToMicros(priorEstimate)) / priorAmount) / 1_000_000;
}

export function buildMerklCanaryOpportunityIntent({ queueItem = {}, sizing = {}, now = new Date().toISOString() } = {}) {
  const intentType = resolveIntentType(bindingKind(queueItem)) || "erc4626_deposit";
  const displayedApr = queueItem.effectiveAprPct
    ?? queueItem.displayedAprPct
    ?? queueItem.aprPct
    ?? queueItem.apr
    ?? queueItem.apy
    ?? null;
  return {
    strategyId: queueItem.mappedStrategyId || null,
    chain: queueItem.chain || null,
    srcChain: queueItem.srcChain || queueItem.chain || null,
    dstChain: queueItem.dstChain || queueItem.chain || null,
    protocol: queueItem.protocolId || queueItem.protocol || null,
    opportunityId: queueItem.opportunityId || null,
    intentType,
    amountUsd: sizing.amountUsd ?? null,
    positionUsd: sizing.amountUsd ?? null,
    mode: "live",
    executionReason: "merkl_canary_autopilot",
    observedAt: now,
    quote: {
      observedAt: now,
    },
    displayedApr,
    apr: queueItem.apr ?? queueItem.aprPct ?? displayedApr ?? null,
    apy: queueItem.apy ?? null,
    rewardTokenType: queueItem.rewardTokenType ?? null,
    rewardToken: queueItem.rewardToken ?? queueItem.rewardTokenSymbol ?? null,
    estimatedCostsUsd: queueItem.estimatedCostsUsd ?? 0,
    estimatedGasCostUsd: queueItem.estimatedGasCostUsd ?? null,
    estimatedBridgeCostUsd: queueItem.estimatedBridgeCostUsd ?? null,
    expectedHoldDays: resolveTinyCanaryExpectedHoldDays({
      expectedHoldDays: queueItem.expectedHoldDays,
      campaignRemainingHours: queueItem.campaignRemainingHours,
      campaignEndsAt: queueItem.campaignEndsAt,
      now,
    }),
    campaignRemainingHours: queueItem.campaignRemainingHours ?? null,
    campaignEndsAt: queueItem.campaignEndsAt ?? null,
    sharePct: queueItem.sharePct ?? 0,
    venue: queueItem.venue ?? null,
    executionSurface: queueItem.executionSurface ?? null,
    metadata: {
      opportunityId: queueItem.opportunityId || null,
      bindingKind: bindingKind(queueItem),
      radarCandidateId: queueItem.metadata?.radarCandidateId ?? null,
      radarPacketId: queueItem.metadata?.radarPacketId ?? null,
      unwindPlan: queueItem.unwindPlan ?? queueItem.metadata?.unwindPlan ?? null,
    },
  };
}

export async function evaluateMerklCanaryOpportunityPolicy({
  queueItem = {},
  sizing = {},
  auditRecords = [],
  now = new Date().toISOString(),
  evaluateOpportunityPolicyImpl = evaluateOpportunityPolicy,
} = {}) {
  const intent = buildMerklCanaryOpportunityIntent({ queueItem, sizing, now });
  const evGate = tinyCanaryEvGate(queueItem, sizing, { now });
  const verdict = await evaluateOpportunityPolicyImpl({
    intent,
    auditRecords,
    now,
  });
  const blockers = verdict?.blockers || [];
  return {
    ok: verdict?.decision !== "BLOCK" && blockers.length === 0,
    blockers,
    intent,
    verdict,
    evGate,
  };
}

function opportunityPolicyBlockedResult(candidate = {}, opportunityPolicy = {}) {
  return {
    status: "blocked",
    blockedReason: opportunityPolicy.blockers?.[0] || "opportunity_policy_blocked",
    queueItem: candidate.queueItem,
    sizing: candidate.sizing,
    opportunityPolicy,
  };
}

export async function selectMerklCanaryOpportunityPolicyReadyCandidates(selection = {}, {
  auditRecords = [],
  now = new Date().toISOString(),
  maxCandidates = 1,
  evaluateOpportunityPolicyImpl = evaluateOpportunityPolicy,
} = {}) {
  const limit = Math.max(1, Number.isInteger(maxCandidates) ? maxCandidates : 1);
  const selected = [];
  const deferred = [];
  for (const candidate of selection.selected || []) {
    const opportunityPolicy = await evaluateMerklCanaryOpportunityPolicy({
      queueItem: candidate.queueItem,
      sizing: candidate.sizing,
      auditRecords,
      now,
      evaluateOpportunityPolicyImpl,
    });
    if (!opportunityPolicy.ok) {
      deferred.push(opportunityPolicyBlockedResult(candidate, opportunityPolicy));
      continue;
    }
    selected.push({ ...candidate, opportunityPolicy });
    if (selected.length >= limit) break;
  }
  return {
    ...selection,
    selected,
    deferred,
  };
}

export async function buildLiveMerklInventorySnapshot({
  queueItem,
  senderAddress,
  readErc20BalanceImpl = readErc20Balance,
  readNativeBalanceImpl = readNativeBalance,
} = {}) {
  if (!queueItem) throw new Error("queueItem is required");
  if (!senderAddress) throw new Error("senderAddress is required");
  const binding = queueItem.protocolBindingPlan?.resolvedBinding || {};
  const tokenBalance = await readErc20BalanceImpl(queueItem.chain, binding.assetAddress, senderAddress);
  const nativeBalance = await readNativeBalanceImpl(queueItem.chain, senderAddress);
  const priorToken = queueItem.executionReadiness?.matchedToken || null;
  const priorNative = queueItem.executionReadiness?.matchedNative || null;
  return {
    address: senderAddress,
    observedAt: new Date().toISOString(),
    native: [
      {
        chain: queueItem.chain,
        asset: priorNative?.asset || tokenAsset(queueItem.chain, ZERO_TOKEN).ticker,
        token: ZERO_TOKEN,
        actual: nativeBalance.balanceWei.toString(),
        actualDecimal: priorNative?.actualDecimal ?? null,
        estimatedUsd: scaledUsdEstimate({
          priorUnits: priorNative?.actual,
          priorUsd: priorNative?.estimatedUsd,
          liveUnits: nativeBalance.balanceWei.toString(),
        }),
        rpcUrl: nativeBalance.rpcUrl || null,
      },
    ],
    tokens: [
      {
        chain: queueItem.chain,
        token: binding.assetAddress,
        ticker: priorToken?.ticker || tokenAsset(queueItem.chain, binding.assetAddress).ticker,
        actual: tokenBalance.balance.toString(),
        actualDecimal: priorToken?.actualDecimal ?? null,
        estimatedUsd: scaledUsdEstimate({
          priorUnits: priorToken?.actual,
          priorUsd: priorToken?.estimatedUsd,
          liveUnits: tokenBalance.balance.toString(),
        }),
        rpcUrl: tokenBalance.rpcUrl || null,
      },
    ],
  };
}

export async function refreshMerklAutopilotSelectionForExecute({
  selected,
  senderAddress,
  canaryExecutions = [],
  now = new Date().toISOString(),
  readErc20BalanceImpl = readErc20Balance,
  readNativeBalanceImpl = readNativeBalance,
  sizingOptions = {},
} = {}) {
  if (!selected?.queueItem) throw new Error("selected queue item is required");
  const inventorySnapshot = await buildLiveMerklInventorySnapshot({
    queueItem: selected.queueItem,
    senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  const queueItem = applyMerklCanaryExecutionReadiness(selected.queueItem, {
    inventorySnapshot,
    canaryExecutions,
    now,
  });
  const sizing = sizeMerklCanaryAmount(queueItem, {
    ...sizingOptions,
    now,
  });
  return {
    queueItem,
    sizing,
    inventorySnapshot,
  };
}

export function merklExecutionErrorReport({
  error,
  execute,
  preflight,
  queue,
  queueItem,
  sizing,
  readyCount,
  representativeCoverage,
} = {}) {
  const message = error?.message || String(error);
  let blockedReason = null;
  if (/Insufficient asset balance:/iu.test(message)) blockedReason = "insufficient_live_asset_balance";
  if (/insufficient_native_balance_for_gas/iu.test(message)) blockedReason = "insufficient_native_gas_balance";
  if (/waitForTransaction failed .*timeout|code=TIMEOUT|timed out/iu.test(message)) blockedReason = "receipt_confirmation_timeout";
  if (/All RPC endpoints failed for chain:/iu.test(message)) blockedReason = "live_inventory_refresh_failed";
  if (/Signer did not complete/iu.test(message)) blockedReason = "signer_execution_failed";
  if (/EvmReceiptReverted|Transaction reverted after broadcast|execution reverted|\\brevert\\b/iu.test(message)) {
    blockedReason = "execution_reverted";
  }
  if (!blockedReason) throw error;
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    mode: execute ? "execute" : "preview",
    status: "blocked",
    blockedReason,
    error: {
      name: error?.name || "Error",
      message,
    },
    preflight: {
      status: preflight.status,
      senderAddress: preflight.senderAddress,
      liveBaseline: preflight.liveBaseline,
      killSwitchPath: preflight.killSwitchPath,
    },
    summary: {
      queueCount: queue.queue?.length || 0,
      readyCount,
      representativeCoverage,
      selectedOpportunityId: queueItem?.opportunityId || null,
      selectedChain: queueItem?.chain || null,
      selectedProtocolId: queueItem?.protocolId || null,
      selectedBindingKind: bindingKind(queueItem),
      selectedAmount: sizing?.amount || null,
      selectedAmountUsd: sizing?.amountUsd ?? null,
    },
    queueItem,
    sizing,
  };
}

function executionBlockedReason(execution = null) {
  const status = execution?.settlementStatus || null;
  if (status === "signer_rejected") {
    return execution?.error?.policy?.blockers?.[0] || "signer_rejected";
  }
  if (status === "failed") return execution?.error?.message || "signer_execution_failed";
  if (status === "share_delta_timeout") return "share_delta_timeout";
  if (status === "redeem_delta_timeout") return "redeem_delta_timeout";
  return null;
}

export async function runMerklCanaryAutopilot({
  execute = false,
  write = false,
  queuePath = join(config.dataDir, "merkl-canary-queue.json"),
  socketPath,
  timeoutMs,
  maxUsd = null,
  maxCandidates = 6,
  maxPerChain = 3,
  maxPerProtocol = 4,
  minEthereumNotionalUsd = DEFAULT_MIN_ETHEREUM_NOTIONAL_USD,
  allowInefficientEthereum = false,
  graduationCanaryRequests = null,
  portfolioAllocatorReportPath = join(config.dataDir, "merkl-portfolio-allocator-latest.json"),
  portfolioOrchestratorReportPath = join(config.dataDir, "merkl-portfolio-orchestrator-latest.json"),
  evaluateOpportunityPolicyImpl = evaluateOpportunityPolicy,
} = {}) {
  const preflight = await preflightLiveCanarySweep({
    socketPath,
    timeoutMs,
    requireLiveBaseline: false,
  });
  if (preflight.status !== "ready") {
    const report = {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      mode: execute ? "execute" : "preview",
      status: "blocked",
      blockedReason: preflight.blockedReason || "live_canary_preflight_not_ready",
      preflight,
    };
    if (write) await writeAutopilotReport(report);
    return report;
  }

  const queue = await readJson(queuePath);
  const [inventoryRecords, protocolCanaryExecutions, autopilotExecutions] = await Promise.all([
    readJsonl(config.dataDir, "treasury-inventory"),
    readJsonl(config.dataDir, "erc4626-protocol-canaries"),
    readJsonl(config.dataDir, "merkl-canary-autopilot-runs").catch(() => []),
  ]);
  const canaryExecutions = [...protocolCanaryExecutions, ...autopilotExecutions];
  const auditRecords = await readJsonl("logs", "signer-audit").catch(() => []);
  const inventorySnapshot = latestTreasuryInventoryForAddress(inventoryRecords, preflight.senderAddress);
  const [portfolioOrchestratorReport, portfolioAllocatorReport] = graduationCanaryRequests == null
    ? await Promise.all([
        portfolioOrchestratorReportPath ? readJsonIfExists(portfolioOrchestratorReportPath) : null,
        portfolioAllocatorReportPath ? readJsonIfExists(portfolioAllocatorReportPath) : null,
      ])
    : [null, null];
  const portfolioGraduationRequests = graduationCanaryRequests == null
    ? dedupeGraduationRequests([
        ...portfolioGraduationRequestsFromReport(portfolioOrchestratorReport),
        ...portfolioGraduationRequestsFromReport(portfolioAllocatorReport),
      ])
    : graduationCanaryRequests;
  const requestedMaxCandidates = Math.max(1, Number.isInteger(maxCandidates) ? maxCandidates : 6);
  const selectionMaxCandidates = execute
    ? Math.max(requestedMaxCandidates * 6, requestedMaxCandidates + 5)
    : requestedMaxCandidates;
  const selection = selectMerklCanaryAutopilotCandidates(queue, {
    maxUsd,
    maxCandidates: selectionMaxCandidates,
    maxPerChain,
    maxPerProtocol,
    minEthereumNotionalUsd,
    allowInefficientEthereum,
    inventorySnapshot,
    canaryExecutions,
    auditRecords,
    graduationCanaryRequests: portfolioGraduationRequests,
  });
  if (!selection.selected.length) {
    const report = {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      mode: execute ? "execute" : "preview",
      status: "blocked",
      blockedReason: "no_autopilot_candidate_ready",
      preflight: {
        status: preflight.status,
        senderAddress: preflight.senderAddress,
        liveBaseline: preflight.liveBaseline,
        killSwitchPath: preflight.killSwitchPath,
      },
      summary: {
        queueCount: queue.queue?.length || 0,
        readyCount: 0,
        representativeCoverage: compactRepresentativeCoverage(queue),
        selectedCount: 0,
        selectedChains: [],
        portfolioGraduationHintCount: portfolioGraduationRequests.length,
      },
      candidates: selection.candidates.map(compactCandidate).slice(0, 20),
    };
    if (write) await writeAutopilotReport(report);
    return report;
  }

  const representativeCoverage = compactRepresentativeCoverage(queue);
  const results = [];
  const executionSelection = execute
    ? await selectMerklCanaryOpportunityPolicyReadyCandidates(selection, {
        auditRecords,
        now: new Date().toISOString(),
        maxCandidates: requestedMaxCandidates,
        evaluateOpportunityPolicyImpl,
      })
    : selection;
  results.push(...(executionSelection.deferred || []));
  for (const selected of executionSelection.selected) {
    let { queueItem, sizing } = selected;
    if (sizing.status !== "ready") {
      results.push({
        status: "blocked",
        blockedReason: sizing.blockers?.[0] || "no_autopilot_candidate_ready",
        queueItem,
        sizing,
      });
      continue;
    }
    if (execute) {
      try {
        const refreshed = await refreshMerklAutopilotSelectionForExecute({
          selected,
          senderAddress: preflight.senderAddress,
          canaryExecutions,
          now: new Date().toISOString(),
          sizingOptions: {
            maxUsd,
            minEthereumNotionalUsd,
            allowInefficientEthereum,
            canaryExecutions,
            auditRecords,
          },
        });
        queueItem = refreshed.queueItem;
        sizing = refreshed.sizing;
      } catch (error) {
        const errorReport = merklExecutionErrorReport({
          error,
          execute,
          preflight,
          queue,
          queueItem,
          sizing,
          readyCount: selection.readyCount,
          representativeCoverage,
        });
        results.push({
          status: "blocked",
          blockedReason: errorReport.blockedReason,
          error: errorReport.error,
          queueItem,
          sizing,
        });
        continue;
      }
      if (sizing.status !== "ready") {
        results.push({
          status: "blocked",
          blockedReason: sizing.blockers?.[0] || "no_autopilot_candidate_ready",
          queueItem,
          sizing,
        });
        continue;
      }
    }
    const opportunityPolicy = await evaluateMerklCanaryOpportunityPolicy({
      queueItem,
      sizing,
      auditRecords,
      now: new Date().toISOString(),
      evaluateOpportunityPolicyImpl,
    });
    if (!opportunityPolicy.ok) {
      results.push({
        status: "blocked",
        blockedReason: opportunityPolicy.blockers[0] || "opportunity_policy_blocked",
        queueItem,
        sizing,
        opportunityPolicy,
      });
      continue;
    }
    const buildPlan = resolvePlanBuilder(bindingKind(queueItem));
    const executePlan = resolvePlanExecutor(bindingKind(queueItem));
    if (!buildPlan || !executePlan) {
      results.push({
        status: "blocked",
        blockedReason: "unsupported_binding_kind",
        queueItem,
        sizing,
      });
      continue;
    }
    try {
      const plan = await buildPlan({
        queueItem,
        senderAddress: preflight.senderAddress,
        amount: sizing.amount,
      });
      const execution = execute
        ? await executePlan({
            plan,
            socketPath,
            timeoutMs,
          })
        : null;
      const blockedReason = executionBlockedReason(execution);
      if (blockedReason) {
        results.push({
          status: "blocked",
          blockedReason,
          queueItem,
          sizing,
          plan,
          execution,
        });
        continue;
      }
      results.push({
        status: execution?.settlementStatus || "preview_ready",
        queueItem,
        sizing,
        plan,
        execution,
      });
    } catch (error) {
      const errorReport = merklExecutionErrorReport({
        error,
        execute,
        preflight,
        queue,
        queueItem,
        sizing,
        readyCount: selection.readyCount,
        representativeCoverage,
      });
      results.push({
        status: "blocked",
        blockedReason: errorReport.blockedReason,
        error: errorReport.error,
        queueItem,
        sizing,
      });
    }
  }
  const firstReady = results.find((item) => item.status !== "blocked") || results[0] || {};
  const resultSummary = summarizeMerklAutopilotResults(results);
  const { deliveredCount, previewReadyCount, blockedCount } = resultSummary;
  const selectedChains = [...new Set(results.map((item) => item.queueItem?.chain).filter(Boolean))];
  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    mode: execute ? "execute" : "preview",
    status: execute
      ? deliveredCount > 0
        ? "delivered"
        : blockedCount === results.length
          ? "blocked"
          : "completed_with_blockers"
      : previewReadyCount > 0
        ? "preview_ready"
        : "blocked",
    blockedReason: blockedCount === results.length ? results[0]?.blockedReason || "no_autopilot_candidate_ready" : null,
    preflight: {
      status: preflight.status,
      senderAddress: preflight.senderAddress,
      liveBaseline: preflight.liveBaseline,
      killSwitchPath: preflight.killSwitchPath,
    },
    summary: {
      queueCount: queue.queue?.length || 0,
      readyCount: selection.readyCount,
      representativeCoverage,
      selectedCount: resultSummary.selectedCount,
      selectedChains,
      executionReadyCount: resultSummary.executionReadyCount,
      previewReadyCount,
      deliveredCount,
      blockedCount,
      blockerCounts: resultSummary.blockerCounts,
      topBlocker: resultSummary.topBlocker,
      topEvGate: resultSummary.topEvGate,
      selectedOpportunityId: firstReady.queueItem?.opportunityId || null,
      selectedChain: firstReady.queueItem?.chain || null,
      selectedProtocolId: firstReady.queueItem?.protocolId || null,
      selectedBindingKind: bindingKind(firstReady.queueItem),
      selectedAmount: firstReady.sizing?.amount || null,
      selectedAmountUsd: firstReady.sizing?.amountUsd ?? null,
      portfolioGraduationHintCount: portfolioGraduationRequests.length,
      selectedPortfolioGraduationHint: firstReady.queueItem?.metadata?.portfolioGraduationRequest || null,
    },
    queueItem: firstReady.queueItem || null,
    sizing: firstReady.sizing || null,
    plan: firstReady.plan || null,
    execution: firstReady.execution || null,
    results,
  };
  if (write) await writeAutopilotReport(report);
  return report;
}

async function writeAutopilotReport(report) {
  await writeTextIfChanged(join(config.dataDir, "merkl-canary-autopilot-latest.json"), `${safeJsonStringify(report, 2)}\n`);
  await new JsonlStore(config.dataDir).append("merkl-canary-autopilot-runs", JSON.parse(safeJsonStringify(report)));
}

export { DEFAULT_MIN_ETHEREUM_NOTIONAL_USD };
