import { WRAPPED_BTC_VENUES } from "../config/destination-venues.mjs";
import { STABLE_VENUES } from "../config/stable-venues.mjs";

const PROTOCOL_ALIASES = Object.freeze({
  aave: Object.freeze(["aave", "aave_v3"]),
  aave_v3: Object.freeze(["aave", "aave_v3"]),
  euler: Object.freeze(["euler", "euler_v2"]),
  euler_v2: Object.freeze(["euler", "euler_v2"]),
  gmx: Object.freeze(["gmx", "gmx_v2"]),
  gmx_v2: Object.freeze(["gmx", "gmx_v2"]),
  pancakeswap: Object.freeze(["pancake", "pancakeswap"]),
  bend: Object.freeze(["bend", "berachain-bend-bex"]),
  bex: Object.freeze(["bex", "berachain-bend-bex"]),
  moonwell: Object.freeze(["moonwell"]),
  morpho: Object.freeze(["morpho"]),
  pendle: Object.freeze(["pendle"]),
  venus: Object.freeze(["venus"]),
  yo: Object.freeze(["yo"]),
});

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function protocolKeys(protocol) {
  const key = normalized(protocol);
  return new Set(PROTOCOL_ALIASES[key] || [key]);
}

function protocolsMatch(left, right) {
  const leftKeys = protocolKeys(left);
  for (const key of protocolKeys(right)) {
    if (leftKeys.has(key)) return true;
  }
  return false;
}

function uniqueBy(items = [], keyFn) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function countBy(items = [], keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item) || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function activePositions(positionRecords = []) {
  const opened = new Map();
  const closed = new Set();
  for (const record of positionRecords || []) {
    const id = record.positionId || record.id || null;
    if (!id) continue;
    if (record.event === "position_opened" || record.status === "open") opened.set(id, record);
    if (record.event === "position_exit_confirmed" || record.event === "position_closed" || record.status === "closed") {
      closed.add(id);
    }
  }
  return [...opened.entries()]
    .filter(([id]) => !closed.has(id))
    .map(([, record]) => record);
}

export function buildRepresentativeTargets({
  wrappedBtcVenues = WRAPPED_BTC_VENUES,
  stableVenues = STABLE_VENUES,
} = {}) {
  const targets = [];
  for (const [chain, entry] of Object.entries(wrappedBtcVenues || {})) {
    for (const venue of entry?.venues || []) {
      targets.push({
        chain,
        protocolId: venue.protocol,
        family: venue.family,
        asset: venue.asset,
        source: "wrapped_btc_venue",
      });
    }
  }
  for (const [chain, entry] of Object.entries(stableVenues || {})) {
    for (const venue of entry?.venues || []) {
      targets.push({
        chain,
        protocolId: venue.protocol,
        family: venue.family,
        asset: venue.depositAsset || venue.pairAsset || null,
        source: "stable_venue",
      });
    }
  }
  return uniqueBy(
    targets,
    (item) => `${item.chain}:${normalized(item.protocolId)}:${normalized(item.family)}:${normalized(item.asset)}:${item.source}`,
  );
}

function targetCoveredBy(target, observed = []) {
  return observed.some((item) => item.chain === target.chain && protocolsMatch(item.protocolId, target.protocolId));
}

function chainNextAction({ queuedCoverCount, activeCoverCount, targetCount }) {
  if (activeCoverCount > 0) return "monitor_active_representative_receipts";
  if (queuedCoverCount > 0) return "satisfy_inventory_binding_and_run_canary";
  if (targetCount > 0) return "source_or_build_representative_opportunity";
  return "add_representative_venue_config";
}

function chainStatus({ queuedCoverCount, activeCoverCount, targetCount }) {
  if (activeCoverCount > 0) return "active_representative";
  if (queuedCoverCount > 0) return "queued_representative";
  if (targetCount > 0) return "missing_representative_queue";
  return "missing_representative_config";
}

export function buildRepresentativeChainCoverage({
  queue = [],
  positionRecords = [],
  now = new Date().toISOString(),
  targets = buildRepresentativeTargets(),
} = {}) {
  const active = activePositions(positionRecords);
  const chains = [...new Set(targets.map((target) => target.chain))].sort();
  const queueObserved = (queue || []).map((item) => ({
    chain: item.chain,
    protocolId: item.protocolId,
    readiness: item.executionReadiness?.status || null,
    bindingStatus: item.protocolBindingPlan?.status || null,
  }));
  const activeObserved = active.map((item) => ({
    chain: item.chain,
    protocolId: item.protocolId,
    amountUsd: item.amountUsd ?? null,
  }));

  const chainCoverage = chains.map((chain) => {
    const chainTargets = targets.filter((target) => target.chain === chain);
    const queuedTargets = chainTargets.filter((target) => targetCoveredBy(target, queueObserved));
    const activeTargets = chainTargets.filter((target) => targetCoveredBy(target, activeObserved));
    const queuedItems = queueObserved.filter((item) => item.chain === chain);
    const activeItems = activeObserved.filter((item) => item.chain === chain);
    const status = chainStatus({
      queuedCoverCount: queuedTargets.length,
      activeCoverCount: activeTargets.length,
      targetCount: chainTargets.length,
    });
    const blockers = [];
    if (status === "missing_representative_queue") blockers.push("representative_opportunity_missing_from_queue");
    if (status === "queued_representative" && queuedItems.some((item) => item.readiness !== "inventory_ready")) {
      blockers.push("representative_inventory_or_gas_not_ready");
    }
    if (status === "queued_representative" && queuedItems.some((item) => item.bindingStatus !== "binding_ready")) {
      blockers.push("representative_protocol_binding_not_ready");
    }
    return {
      chain,
      status,
      nextAction: chainNextAction({
        queuedCoverCount: queuedTargets.length,
        activeCoverCount: activeTargets.length,
        targetCount: chainTargets.length,
      }),
      targetCount: chainTargets.length,
      queuedRepresentativeCount: queuedTargets.length,
      activeRepresentativeCount: activeTargets.length,
      queueCount: queuedItems.length,
      activePositionCount: activeItems.length,
      protocols: {
        target: [...new Set(chainTargets.map((target) => target.protocolId))],
        queued: [...new Set(queuedItems.map((item) => item.protocolId).filter(Boolean))],
        active: [...new Set(activeItems.map((item) => item.protocolId).filter(Boolean))],
      },
      blockers,
    };
  });

  const statusCounts = countBy(chainCoverage, (item) => item.status);
  const missing = chainCoverage.filter((item) => item.status.startsWith("missing_"));
  const queued = chainCoverage.filter((item) => item.status === "queued_representative");
  const activeRepresentative = chainCoverage.filter((item) => item.status === "active_representative");

  return {
    schemaVersion: 1,
    generatedAt: now,
    policy: {
      objective: "avoid single-chain or single-protocol concentration by tracking representative venues per official destination",
      executionRule: "coverage targets create refill/canary work only; they never bypass inventory, binding, cap, policy, or receipt gates",
    },
    summary: {
      chainCount: chainCoverage.length,
      targetCount: targets.length,
      activeRepresentativeChainCount: activeRepresentative.length,
      queuedRepresentativeChainCount: queued.length,
      missingRepresentativeChainCount: missing.length,
      statusCounts,
      missingChains: missing.map((item) => item.chain),
      topMissingChain: missing[0]?.chain || null,
    },
    chains: chainCoverage,
  };
}
