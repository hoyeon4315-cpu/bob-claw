import { EVM_CHAINS } from "../chains/registry.mjs";
import { classifySimulationError, simulateTransactionCall } from "../evm/transaction-read.mjs";
import { classifyGasEstimateError, estimateGas, gasUsdFromSnapshot, getGasSnapshot } from "../gas/rpc-gas.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function selectionKey(routeKey, amount) {
  if (!routeKey || !amount) return null;
  return `${routeKey}|${amount}`;
}

function normalizedAddress(value) {
  return String(value || "").toLowerCase();
}

function sameAddress(left, right) {
  const normalizedLeft = normalizedAddress(left);
  const normalizedRight = normalizedAddress(right);
  return normalizedLeft !== "" && normalizedLeft === normalizedRight;
}

function latestQuotesByRouteAndAmount(quotes = []) {
  const latest = new Map();
  for (const quote of quotes) {
    if (!quote?.routeKey || !quote?.amount) continue;
    const key = selectionKey(quote.routeKey, quote.amount);
    const existing = latest.get(key);
    if (!existing || new Date(quote.observedAt) > new Date(existing.observedAt)) {
      latest.set(key, quote);
    }
  }
  return latest;
}

function latestWalletReadinessByRouteAndAmount(records = [], address = null) {
  const latest = new Map();
  for (const record of records || []) {
    if (!record?.routeKey || !record?.amount) continue;
    if (address && record.address && !sameAddress(address, record.address)) continue;
    const key = selectionKey(record.routeKey, record.amount);
    const existing = latest.get(key);
    if (!existing || new Date(record.observedAt || 0) > new Date(existing.observedAt || 0)) {
      latest.set(key, record);
    }
  }
  return latest;
}

function walletReadinessRank(record = null) {
  if (!record) return 1;
  return record.overallReady === false ? 2 : 0;
}

function routeLabel(item) {
  if (!item) return null;
  if (item.label) return item.label;
  if (item.routeLabel) return item.routeLabel;
  if (item.route?.srcChain && item.route?.dstChain) {
    return `${item.route.srcChain}->${item.route.dstChain}`;
  }
  return item.routeKey || null;
}

function simulationSkipReason(quote) {
  if (!quote?.route?.srcChain) return "missing_route";
  if (quote.route.srcChain === "bitcoin") return "bitcoin_source_no_evm_tx";
  if (!EVM_CHAINS[quote.route.srcChain]) return "unsupported_source_chain";
  if (!quote.txTo) return "missing_tx_to";
  if (!quote.txData) return "missing_tx_data";
  return null;
}

function queueTargets(refreshPlan = null, shadowCycle = null) {
  return (refreshPlan?.items || shadowCycle?.refreshQueue || [])
    .filter((item) => item?.routeKey && item?.amount)
    .map((item) => ({
      routeKey: item.routeKey,
      amount: item.amount,
      source: "queue",
      sourceLabel: item.scope || "queue",
      queueRank: item.rank ?? null,
      reason: item.reason || null,
      label: item.routeLabel || null,
      code: item.code || null,
    }));
}

function objectiveTargets(shadowCycle = null) {
  return [
    shadowCycle?.objectivePlans?.executionReview
      ? {
          routeKey: shadowCycle.objectivePlans.executionReview.routeKey,
          amount: shadowCycle.objectivePlans.executionReview.amount,
          source: "objective_execution_review",
          sourceLabel: "execution_review",
          queueRank: null,
          reason: shadowCycle.objectivePlans.executionReview.selectionCode || null,
          label: shadowCycle.objectivePlans.executionReview.label || null,
          code: shadowCycle.objectivePlans.executionReview.nextActionCode || null,
        }
      : null,
    shadowCycle?.objectivePlans?.discovery
      ? {
          routeKey: shadowCycle.objectivePlans.discovery.routeKey,
          amount: shadowCycle.objectivePlans.discovery.amount,
          source: "objective_discovery",
          sourceLabel: shadowCycle.objectivePlans.discovery.source || "strategy_discovery",
          queueRank: null,
          reason: shadowCycle.objectivePlans.discovery.selectionCode || null,
          label: shadowCycle.objectivePlans.discovery.label || null,
          code: shadowCycle.objectivePlans.discovery.nextActionCode || null,
        }
      : null,
  ].filter(Boolean);
}

function canaryTargets(shadowCycle = null) {
  return shadowCycle?.topRoute?.routeKey && shadowCycle?.topRoute?.amount
    ? [
        {
          routeKey: shadowCycle.topRoute.routeKey,
          amount: shadowCycle.topRoute.amount,
          source: "current_canary",
          sourceLabel: "current_canary",
          queueRank: null,
          reason: shadowCycle.topRoute.tradeReadiness || null,
          label: shadowCycle.topRoute.label || null,
          code: shadowCycle.topRoute.tradeReadiness || null,
        },
      ]
    : [];
}

export function selectSimulationTargets({
  quotes = [],
  walletReadiness = [],
  address = null,
  refreshPlan = null,
  shadowCycle = null,
  source = "objective",
  routeKey = null,
  amount = null,
  limit = 4,
} = {}) {
  const latestBySelection = latestQuotesByRouteAndAmount(quotes);
  const exact = routeKey && amount
    ? [
        {
          routeKey,
          amount,
          source: "exact_route",
          sourceLabel: "exact_route",
          queueRank: null,
          reason: null,
          label: null,
          code: null,
        },
      ]
    : null;
  const objectiveWithQueue = [...objectiveTargets(shadowCycle), ...queueTargets(refreshPlan, shadowCycle)];

  const candidates =
    exact ||
    (source === "queue"
      ? queueTargets(refreshPlan, shadowCycle)
      : source === "canary"
        ? canaryTargets(shadowCycle)
        : objectiveWithQueue);
  const readinessBySelection = latestWalletReadinessByRouteAndAmount(walletReadiness, address);
  const prioritizedCandidates =
    exact ||
    candidates
      .map((target, index) => ({
        target,
        index,
        readiness: readinessBySelection.get(selectionKey(target.routeKey, target.amount)) || null,
      }))
      .filter(({ readiness }) => readiness?.overallReady !== false)
      .sort((left, right) => {
        const rankDiff = walletReadinessRank(left.readiness) - walletReadinessRank(right.readiness);
        return rankDiff !== 0 ? rankDiff : left.index - right.index;
      })
      .map(({ target }) => target);

  const selected = [];
  const seen = new Set();
  for (const target of prioritizedCandidates) {
    const key = selectionKey(target.routeKey, target.amount);
    if (!key || seen.has(key)) continue;
    const quote = latestBySelection.get(key);
    if (!quote) continue;
    selected.push({
      ...target,
      quote,
    });
    seen.add(key);
    if (selected.length >= limit) break;
  }
  return selected;
}

export async function simulateQuoteMechanicalPath({
  selection,
  from,
  prices = {},
  getGasSnapshotImpl = getGasSnapshot,
  estimateGasImpl = estimateGas,
  simulateTransactionCallImpl = simulateTransactionCall,
} = {}) {
  const quote = selection?.quote || null;
  const now = new Date().toISOString();
  const baseRecord = {
    schemaVersion: 1,
    observedAt: now,
    routeKey: quote?.routeKey || selection?.routeKey || null,
    routeLabel: routeLabel(selection) || routeLabel(quote),
    amount: quote?.amount || selection?.amount || null,
    srcChain: quote?.route?.srcChain || null,
    dstChain: quote?.route?.dstChain || null,
    source: selection?.source || null,
    sourceLabel: selection?.sourceLabel || null,
    queueRank: selection?.queueRank ?? null,
    selectionReason: selection?.reason || null,
    selectionCode: selection?.code || null,
    from: from || null,
    txTo: quote?.txTo || null,
    txValueWei: quote?.txValueWei || "0",
    txDataBytes: quote?.txDataBytes ?? null,
    tradeReadiness: selection?.score?.tradeReadiness || null,
    netEdgeUsd: selection?.score?.netEdgeUsd ?? null,
    executableNetEdgeUsd: selection?.score?.executableNetEdgeUsd ?? null,
  };

  const skipReason = simulationSkipReason(quote);
  if (skipReason) {
    return {
      ...baseRecord,
      status: "skipped",
      ok: false,
      skipReason,
      estimatedGasUsd: null,
      gasEstimate: null,
      call: null,
    };
  }

  const sourceChain = quote.route.srcChain;
  const [gasSnapshotResult, gasEstimateResult, callResult] = await Promise.allSettled([
    getGasSnapshotImpl(sourceChain),
    estimateGasImpl(sourceChain, {
      from,
      to: quote.txTo,
      data: quote.txData,
      valueWei: quote.txValueWei || "0",
    }),
    simulateTransactionCallImpl(sourceChain, {
      from,
      to: quote.txTo,
      data: quote.txData,
      valueWei: quote.txValueWei || "0",
    }),
  ]);

  const gasEstimateOk = gasEstimateResult.status === "fulfilled";
  const callOk = callResult.status === "fulfilled";
  const gasSnapshotOk = gasSnapshotResult.status === "fulfilled";
  const nativeUsd = prices?.nativeByChain?.[sourceChain];
  const estimatedGasUsd =
    gasEstimateOk && gasSnapshotOk ? gasUsdFromSnapshot(gasSnapshotResult.value, nativeUsd, gasEstimateResult.value.gasUnits) : null;

  return {
    ...baseRecord,
    status: gasEstimateOk && callOk ? "simulated_ok" : "simulation_failed",
    ok: gasEstimateOk && callOk,
    skipReason: null,
    estimatedGasUsd: finite(estimatedGasUsd),
    gasEstimate: gasEstimateOk
      ? {
          ok: true,
          gasUnits: gasEstimateResult.value.gasUnits,
          latencyMs: gasEstimateResult.value.latencyMs,
          rpcUrl: gasEstimateResult.value.rpcUrl,
        }
      : {
          ok: false,
          reason: classifyGasEstimateError(gasEstimateResult.reason),
          error: {
            name: gasEstimateResult.reason.name,
            message: gasEstimateResult.reason.message,
          },
        },
    call: callOk
      ? {
          ok: true,
          rpcUrl: callResult.value.rpcUrl,
          blockTag: callResult.value.blockTag,
          returnDataBytes: Math.max(0, (String(callResult.value.returnData || "0x").length - 2) / 2),
        }
      : {
          ok: false,
          reason: classifySimulationError(callResult.reason),
          error: {
            name: callResult.reason.name,
            message: callResult.reason.message,
          },
        },
    gasSnapshot: gasSnapshotOk
      ? {
          ok: true,
          rpcUrl: gasSnapshotResult.value.rpcUrl,
          gasPriceWei: gasSnapshotResult.value.gasPriceWei,
          nativeUsd: finite(nativeUsd),
        }
      : {
          ok: false,
          error: {
            name: gasSnapshotResult.reason.name,
            message: gasSnapshotResult.reason.message,
          },
        },
  };
}

export function buildSimulationSummary(records = [], { targetSuccessCount = 50 } = {}) {
  const successCount = records.filter((item) => item.status === "simulated_ok").length;
  const failureCount = records.filter((item) => item.status === "simulation_failed").length;
  const skippedCount = records.filter((item) => item.status === "skipped").length;
  const routeSelectionCount = new Set(records.map((item) => selectionKey(item.routeKey, item.amount)).filter(Boolean)).size;
  const latestSuccess = [...records]
    .filter((item) => item.status === "simulated_ok")
    .sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0] || null;
  const latestFailure = [...records]
    .filter((item) => item.status === "simulation_failed")
    .sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0] || null;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runCount: records.length,
    successCount,
    failureCount,
    skippedCount,
    routeSelectionCount,
    targetSuccessCount,
    successRemaining: Math.max(0, targetSuccessCount - successCount),
    latestSuccessAt: latestSuccess?.observedAt || null,
    latestFailureAt: latestFailure?.observedAt || null,
    latestFailureReason: latestFailure?.call?.reason || latestFailure?.gasEstimate?.reason || latestFailure?.skipReason || null,
  };
}
