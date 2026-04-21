// Multi-hop bootstrap planner.
//
// Plan §5b.2 T20. When the operator deposits fresh BTC or tops up a
// destination-chain float, the Capital Manager often needs a chain of
// hops to reach the strategy's settlement token. Example: deposit on
// BTC L1 -> Gateway onramp to BOB wBTC.OFT -> LayerZero OFT hop to
// Base wBTC.OFT -> swap to Base cbBTC -> seed Moonwell loop.
//
// This module plans that chain deterministically. It does NOT execute
// hops; it emits an ordered list of intents the signer/Capital
// Manager consume via the existing route-demand / refill-job
// pipelines.
//
// Pure function. Caller supplies:
//   - sourceAsset       {chain, asset, amountWei}
//   - targetAsset       {chain, asset, minAmountWei?}
//   - hopCatalog        list of atomic hops: {from, to, kind, estimatedFeeBps?}
//                       where from/to are {chain, asset}
//   - gasFloats         {chain: {actualWei, targetWei, decimals}}
//                       (already in that shape from Gas Float Keeper)
//
// Output: ordered intents[] with running-balance math, plus the list
// of chains that need a gas top-up before the plan can start.
//
// The planner uses a bounded BFS over hopCatalog (max 6 hops) to find
// a path from source to target. If multiple paths exist, the lowest
// estimatedFeeBps path wins; ties broken by hop count then by
// lexicographic chain/asset id so the output is deterministic.

const MAX_HOPS = 6;

function keyFor(asset) {
  return `${String(asset.chain).toLowerCase()}::${String(asset.asset).toLowerCase()}`;
}

function feeOf(hop) {
  const v = Number(hop?.estimatedFeeBps);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function applyFee(amountWei, feeBps) {
  if (amountWei == null) return 0n;
  if (!feeBps || feeBps === 0) return amountWei;
  // bps integer math — caller supplies integer bps, we keep bigint-safe.
  const amt = typeof amountWei === "bigint" ? amountWei : BigInt(amountWei);
  const num = amt * (10_000n - BigInt(Math.round(feeBps)));
  return num / 10_000n;
}

// Build adjacency: Map<fromKey, hop[]>
function buildAdjacency(hopCatalog) {
  const adj = new Map();
  for (const hop of hopCatalog || []) {
    if (!hop?.from || !hop?.to || !hop?.kind) continue;
    const k = keyFor(hop.from);
    const list = adj.get(k) || [];
    list.push({
      ...hop,
      fromKey: keyFor(hop.from),
      toKey: keyFor(hop.to),
      estimatedFeeBps: feeOf(hop),
    });
    adj.set(k, list);
  }
  // Deterministic ordering within each adjacency list.
  for (const list of adj.values()) {
    list.sort((a, b) => a.estimatedFeeBps - b.estimatedFeeBps || a.toKey.localeCompare(b.toKey));
  }
  return adj;
}

// BFS that enumerates candidate paths up to MAX_HOPS, selecting the
// one with minimum total fee bps (sum — an approximation of compounded
// fees that is monotonic enough for ranking).
function findBestPath(adj, sourceKey, targetKey) {
  if (sourceKey === targetKey) return { hops: [], totalFeeBps: 0 };
  const queue = [{ key: sourceKey, path: [], totalFeeBps: 0 }];
  let best = null;
  const visited = new Map(); // key -> best totalFeeBps seen
  visited.set(sourceKey, 0);
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur.path.length >= MAX_HOPS) continue;
    const next = adj.get(cur.key) || [];
    for (const hop of next) {
      if (cur.path.some((h) => h.fromKey === hop.fromKey && h.toKey === hop.toKey)) continue;
      const total = cur.totalFeeBps + hop.estimatedFeeBps;
      if (visited.has(hop.toKey) && visited.get(hop.toKey) <= total) {
        if (hop.toKey !== targetKey) continue;
      }
      visited.set(hop.toKey, total);
      const newPath = [...cur.path, hop];
      if (hop.toKey === targetKey) {
        if (!best || total < best.totalFeeBps || (total === best.totalFeeBps && newPath.length < best.hops.length)) {
          best = { hops: newPath, totalFeeBps: total };
        }
        continue;
      }
      queue.push({ key: hop.toKey, path: newPath, totalFeeBps: total });
    }
  }
  return best;
}

function normalizeAmountWei(value) {
  if (value == null) return 0n;
  if (typeof value === "bigint") return value;
  try { return BigInt(value); } catch { return 0n; }
}

function gasBelowFloor(gasFloats, chain) {
  const entry = gasFloats?.[chain];
  if (!entry) return true;
  const actual = normalizeAmountWei(entry.actualWei ?? entry.actual);
  const target = normalizeAmountWei(entry.targetWei ?? entry.target);
  return actual < target;
}

export function planBootstrapHops({
  sourceAsset,
  targetAsset,
  hopCatalog = [],
  gasFloats = {},
  observedAt = new Date().toISOString(),
} = {}) {
  if (!sourceAsset?.chain || !sourceAsset?.asset) {
    throw new TypeError("sourceAsset {chain, asset, amountWei} required");
  }
  if (!targetAsset?.chain || !targetAsset?.asset) {
    throw new TypeError("targetAsset {chain, asset} required");
  }
  const amountWei = normalizeAmountWei(sourceAsset.amountWei);
  if (amountWei === 0n) {
    throw new TypeError("sourceAsset.amountWei must be > 0");
  }

  const adj = buildAdjacency(hopCatalog);
  const sourceKey = keyFor(sourceAsset);
  const targetKey = keyFor(targetAsset);
  const path = findBestPath(adj, sourceKey, targetKey);

  if (!path) {
    return Object.freeze({
      schemaVersion: 1,
      observedAt,
      ok: false,
      reason: "no_path_found",
      source: Object.freeze({ ...sourceAsset }),
      target: Object.freeze({ ...targetAsset }),
      intents: Object.freeze([]),
      gasTopUps: Object.freeze([]),
      totalFeeBps: null,
    });
  }

  // Same-asset / same-chain no-op.
  if (path.hops.length === 0) {
    return Object.freeze({
      schemaVersion: 1,
      observedAt,
      ok: true,
      reason: "already_at_target",
      source: Object.freeze({ ...sourceAsset }),
      target: Object.freeze({ ...targetAsset }),
      intents: Object.freeze([]),
      gasTopUps: Object.freeze([]),
      totalFeeBps: 0,
      hopCount: 0,
      estimatedOutputWei: amountWei.toString(),
    });
  }

  // Walk path, build intents with running-balance math.
  let running = amountWei;
  const intents = [];
  const chainsTouched = new Set();
  for (const hop of path.hops) {
    const inputWei = running;
    running = applyFee(running, hop.estimatedFeeBps);
    chainsTouched.add(hop.from.chain);
    intents.push(Object.freeze({
      order: intents.length,
      kind: hop.kind,
      from: Object.freeze({ ...hop.from }),
      to: Object.freeze({ ...hop.to }),
      inputWei: inputWei.toString(),
      estimatedOutputWei: running.toString(),
      estimatedFeeBps: hop.estimatedFeeBps,
      label: hop.label || null,
    }));
  }

  // Check minAmountWei on target, if supplied.
  const minTarget = targetAsset.minAmountWei ? normalizeAmountWei(targetAsset.minAmountWei) : null;
  const meetsMin = minTarget == null || running >= minTarget;

  // Gas top-ups: any chain that needs a hop but has gas < target.
  const gasTopUps = [];
  for (const chain of chainsTouched) {
    if (gasBelowFloor(gasFloats, chain)) {
      const entry = gasFloats?.[chain] || {};
      gasTopUps.push(Object.freeze({
        chain,
        currentWei: normalizeAmountWei(entry.actualWei ?? entry.actual).toString(),
        targetWei: normalizeAmountWei(entry.targetWei ?? entry.target).toString(),
        refillToTargetWei: (normalizeAmountWei(entry.targetWei ?? entry.target) - normalizeAmountWei(entry.actualWei ?? entry.actual)).toString(),
      }));
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    observedAt,
    ok: meetsMin && gasTopUps.length === 0,
    reason: !meetsMin
      ? "below_min_target"
      : gasTopUps.length > 0
        ? "gas_top_up_required_first"
        : "ready",
    source: Object.freeze({ ...sourceAsset }),
    target: Object.freeze({ ...targetAsset }),
    intents: Object.freeze(intents),
    gasTopUps: Object.freeze(gasTopUps),
    hopCount: intents.length,
    totalFeeBps: path.totalFeeBps,
    estimatedOutputWei: running.toString(),
    meetsMinTarget: meetsMin,
  });
}
