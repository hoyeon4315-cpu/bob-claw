import { createHash } from "node:crypto";
import { ANNOUNCED_GATEWAY_CHAINS } from "../../chains/gateway-announced.mjs";

const OFFICIAL_DESTINATIONS = new Set(ANNOUNCED_GATEWAY_CHAINS);

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundUsd(value) {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function capitalRoutingIntentHash(intent = {}) {
  return createHash("sha256").update(stableJson(intent)).digest("hex").slice(0, 16);
}

function firstPerChain(caps = {}) {
  return Object.keys(caps.perChainUsd || {})[0] || null;
}

function destinationChainFor(row = {}, caps = {}) {
  return row.destinationChain || row.chain || firstPerChain(caps) || null;
}

function capLimitFor(row = {}, caps = {}, destinationChain = null) {
  const perTxUsd = finiteNumber(caps.perTxUsd);
  const perChainUsd = finiteNumber(caps.perChainUsd?.[destinationChain]);
  const raw = Math.min(
    ...[perTxUsd, perChainUsd].filter((value) => Number.isFinite(value)),
  );
  if (!Number.isFinite(raw)) return finiteNumber(row.capitalDeltaNeededUsd) ?? 0;
  return raw;
}

function sourceFor(row = {}, treasury = {}) {
  const sources = Array.isArray(row.capitalSourceCandidates) && row.capitalSourceCandidates.length
    ? row.capitalSourceCandidates
    : Array.isArray(treasury.sources)
      ? treasury.sources
      : [];
  return sources.find((source) => (finiteNumber(source.amountUsd ?? source.freeUsd ?? source.usd) ?? 0) > 0) || {};
}

function actionType(row = {}) {
  if (row.classification === "ready_no_capital_change") return "no_op";
  const source = row.capitalSourceCandidates?.[0] || {};
  if (source.chain && row.destinationChain && source.chain !== row.destinationChain) return "consolidate_for_strategy";
  return "fund_strategy";
}

function preDispatchChecks({
  row = {},
  destinationChain = null,
  guards = {},
  readiness = {},
  activeChainSet = [],
} = {}) {
  const failures = [];
  if (readiness.operatorHold === true) failures.push("operator_hold");
  if (readiness.pausedByAutoKill === true) failures.push("paused_by_auto_kill");
  if (Array.isArray(readiness.positionActions) && readiness.positionActions.some((item) => item?.type === "exit" || item?.type === "unwind")) {
    failures.push("position_exiting");
  }
  if (guards.readyForLiveBroadcast === false) failures.push("readiness_guard_blocked");
  if (guards.killSwitchActive === true) failures.push("kill_switch_active");
  if (guards.devLockActive === true) failures.push("dev_lock_active");
  const activeChains = new Set(activeChainSet);
  if (destinationChain && !OFFICIAL_DESTINATIONS.has(destinationChain) && !activeChains.has(destinationChain)) {
    failures.push("destination_chain_not_gateway_or_active");
  }
  if (row.classification === "ready_with_capital_addition" && !(finiteNumber(row.capitalDeltaNeededUsd) > 0)) {
    failures.push("capital_delta_missing");
  }
  return { passed: failures.length === 0, failures };
}

function buildIntent({
  row,
  amountUsd,
  source,
  destinationChain,
  destinationAsset,
} = {}) {
  const intent = {
    intentType: "capital_rebalance",
    strategyId: row.strategyId,
    chain: destinationChain,
    amountUsd: roundUsd(amountUsd),
    sourceChain: source.chain || null,
    sourceAsset: source.asset || source.token || source.ticker || null,
    destinationAsset,
    reason: "variance_floor_min_notional",
    expectedDailyUsdOnResolve: finiteNumber(row.expectedDailyUsdOnResolve),
    classification: row.classification,
  };
  return {
    ...intent,
    intentHash: capitalRoutingIntentHash(intent),
  };
}

function recommendedActionFor(row = {}) {
  if (row.classification === "floor_infeasible_at_committed_caps") return "edit src/config/strategy-caps.mjs committed cap diff or deprecate lane";
  if (row.classification === "negative_or_zero_edge") return "fix strategy edge model before allocating more capital";
  if (row.classification === "thin_evidence") return "refresh receipt evidence before capital allocation";
  if (row.classification === "missing_input") return "refresh economics inputs before capital allocation";
  if (row.classification === "missing_yield_evidence") return "run yield-position simulator before capital allocation";
  if (row.classification === "ready_with_yield_shadow_evidence") return "validate tiny canary or receipt path before capital allocation";
  return "acquire or free operating capital";
}

export function buildCapitalRoutingPlan({
  classifications = [],
  scoredTargetBalances = null,
  treasurySnapshot = {},
  strategyCapsById = {},
  guards = {},
  readinessByStrategy = {},
  activeChainSet = [],
  now = new Date().toISOString(),
} = {}) {
  const freeCapitalUsd = Math.max(0, finiteNumber(treasurySnapshot.freeCapitalUsd) ?? 0);
  const lockedCapitalUsd = Math.max(0, finiteNumber(treasurySnapshot.lockedCapitalUsd) ?? 0);
  const sorted = [...(classifications || [])].sort((left, right) => {
    const l = finiteNumber(left.expectedDailyUsdOnResolve);
    const r = finiteNumber(right.expectedDailyUsdOnResolve);
    if (l !== null || r !== null) return (r ?? Number.NEGATIVE_INFINITY) - (l ?? Number.NEGATIVE_INFINITY);
    return String(left.strategyId).localeCompare(String(right.strategyId));
  });
  let remainingFreeUsd = freeCapitalUsd;
  const routingPlan = [];
  const unresolvable = [];

  for (const row of sorted) {
    const caps = strategyCapsById[row.strategyId]?.caps || strategyCapsById[row.strategyId] || {};
    const destinationChain = destinationChainFor(row, caps);
    const source = sourceFor(row, treasurySnapshot);
    const destinationAsset = row.destinationAsset || source.asset || source.token || "USDC";
    if (row.classification === "ready_no_capital_change") {
      const checks = preDispatchChecks({
        row,
        destinationChain,
        guards,
        readiness: readinessByStrategy[row.strategyId] || {},
        activeChainSet,
      });
      routingPlan.push({
        action: "no_op",
        strategyId: row.strategyId,
        sourceChain: null,
        destinationChain,
        sourceAsset: null,
        destinationAsset,
        amountUsd: 0,
        expectedDailyUsdOnResolve: finiteNumber(row.expectedDailyUsdOnResolve),
        classification: row.classification,
        preDispatchChecks: checks,
        enqueueIntent: null,
      });
      continue;
    }
    if (row.classification !== "ready_with_capital_addition") {
      unresolvable.push({
        strategyId: row.strategyId,
        classification: row.classification,
        recommendedAction: recommendedActionFor(row),
      });
      continue;
    }
    const requestedUsd = Math.max(0, finiteNumber(row.capitalDeltaNeededUsd) ?? 0);
    const capLimitUsd = capLimitFor(row, caps, destinationChain);
    const sourceFreeUsd = finiteNumber(source.amountUsd ?? source.freeUsd ?? source.usd) ?? remainingFreeUsd;
    const amountUsd = roundUsd(Math.min(requestedUsd, capLimitUsd, sourceFreeUsd, remainingFreeUsd));
    if (!(amountUsd > 0)) {
      unresolvable.push({
        strategyId: row.strategyId,
        classification: "needs_capital_acquisition",
        recommendedAction: recommendedActionFor({ ...row, classification: "needs_capital_acquisition" }),
      });
      continue;
    }
    const checks = preDispatchChecks({
      row,
      destinationChain,
      guards,
      readiness: readinessByStrategy[row.strategyId] || {},
      activeChainSet,
    });
    const enqueueIntent = buildIntent({ row, amountUsd, source, destinationChain, destinationAsset });
    routingPlan.push({
      action: actionType({ ...row, destinationChain }),
      strategyId: row.strategyId,
      sourceChain: source.chain || null,
      destinationChain,
      sourceAsset: source.asset || source.token || source.ticker || null,
      destinationAsset,
      amountUsd,
      expectedDailyUsdOnResolve: finiteNumber(row.expectedDailyUsdOnResolve),
      classification: row.classification,
      preDispatchChecks: checks,
      enqueueIntent,
    });
    remainingFreeUsd = Math.max(0, remainingFreeUsd - amountUsd);
  }

  return {
    schemaVersion: 1,
    generatedAt: now,
    treasury: {
      freeCapitalUsd,
      lockedCapitalUsd,
      perChainUsd: treasurySnapshot.perChainUsd || {},
    },
    scoredTargetBalances,
    routingPlan,
    unresolvable,
    totalExpectedDailyUsdOnResolve: roundUsd(
      routingPlan.reduce((sum, row) => sum + (finiteNumber(row.expectedDailyUsdOnResolve) ?? 0), 0),
    ),
  };
}
