// Diversification policy: per-strategy / per-chain / per-protocol share caps
// plus HHI (Herfindahl-Hirschman Index) concentration gate.
//
// Pure config + pure functions. No I/O. No LLM. Changing any threshold
// requires a committed diff (invariant #5: cap = code).
//
// Reference: plan §3 (capital diversification rules), §4 concentration-guard.
// Rationale: 2026-04 exploits (Kelp $292M, Drift $285M, Aperture $3.7M,
// Moonwell oracle $1.78M) show single-protocol blast radius is the dominant
// residual risk once transport is proven.

export { OFFICIAL_GATEWAY_DESTINATION_CHAINS as GATEWAY_OFFICIAL_CHAINS } from "./gateway-destinations.mjs";
import { OFFICIAL_GATEWAY_DESTINATION_CHAINS as GATEWAY_OFFICIAL_CHAINS } from "./gateway-destinations.mjs";

export const DIVERSIFICATION_POLICY = Object.freeze({
  perStrategyMaxShare: 0.25,
  perChainMaxShare: 0.35,
  perProtocolMaxShare: 0.30,
  hhiMax: 0.30,
  bobL2DirectMaxShare: 0.10,
  minSharesForHhi: 2,
});

function sumShares(sharesByKey) {
  let total = 0;
  for (const v of Object.values(sharesByKey)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new TypeError("share values must be finite non-negative numbers");
    }
    total += v;
  }
  return total;
}

// Shares are fractions of total operating BTC (in [0,1]).
// HHI here = sum(share^2); unallocated cash is treated as an unconcentrated
// residual (share 1-sum, which drops out of the sum of squares on active
// positions). With mode="normalized", renormalize to allocated-only (legacy).
export function computeHhi(sharesByKey, { mode = "portfolio" } = {}) {
  const total = sumShares(sharesByKey);
  if (total === 0) return 0;
  let sumSq = 0;
  if (mode === "normalized") {
    for (const v of Object.values(sharesByKey)) {
      const p = v / total;
      sumSq += p * p;
    }
  } else {
    for (const v of Object.values(sharesByKey)) {
      sumSq += v * v;
    }
  }
  return sumSq;
}

export function evaluateDiversification(allocations, policy = DIVERSIFICATION_POLICY) {
  const perStrategy = allocations.perStrategy ?? {};
  const perChain = allocations.perChain ?? {};
  const perProtocol = allocations.perProtocol ?? {};
  const bobL2Direct = Number(allocations.bobL2DirectShare ?? 0);

  const violations = [];

  for (const [id, share] of Object.entries(perStrategy)) {
    if (share > policy.perStrategyMaxShare) {
      violations.push({
        kind: "per_strategy_share_exceeded",
        id,
        share,
        max: policy.perStrategyMaxShare,
      });
    }
  }
  for (const [id, share] of Object.entries(perChain)) {
    if (!GATEWAY_OFFICIAL_CHAINS.includes(id)) {
      violations.push({ kind: "chain_not_gateway_official", id });
    }
    if (share > policy.perChainMaxShare) {
      violations.push({
        kind: "per_chain_share_exceeded",
        id,
        share,
        max: policy.perChainMaxShare,
      });
    }
  }
  for (const [id, share] of Object.entries(perProtocol)) {
    if (share > policy.perProtocolMaxShare) {
      violations.push({
        kind: "per_protocol_share_exceeded",
        id,
        share,
        max: policy.perProtocolMaxShare,
      });
    }
  }
  if (bobL2Direct > policy.bobL2DirectMaxShare) {
    violations.push({
      kind: "bob_l2_direct_share_exceeded",
      share: bobL2Direct,
      max: policy.bobL2DirectMaxShare,
    });
  }

  const activeStrategies = Object.values(perStrategy).filter((v) => v > 0).length;
  const hhi = computeHhi(perStrategy);
  if (activeStrategies >= policy.minSharesForHhi && hhi > policy.hhiMax) {
    violations.push({ kind: "hhi_exceeded", hhi, max: policy.hhiMax });
  }

  return {
    ok: violations.length === 0,
    hhi,
    activeStrategies,
    violations,
  };
}

export function canAcceptNewAllocation(currentAllocations, candidate, policy = DIVERSIFICATION_POLICY) {
  const merged = mergeAllocation(currentAllocations, candidate);
  const verdict = evaluateDiversification(merged, policy);
  return {
    accepted: verdict.ok,
    verdict,
    projectedAllocations: merged,
  };
}

function mergeAllocation(current, candidate) {
  const out = {
    perStrategy: { ...(current.perStrategy ?? {}) },
    perChain: { ...(current.perChain ?? {}) },
    perProtocol: { ...(current.perProtocol ?? {}) },
    bobL2DirectShare: Number(current.bobL2DirectShare ?? 0),
  };
  const addShare = Number(candidate.addShare ?? 0);
  if (!Number.isFinite(addShare) || addShare < 0) {
    throw new TypeError("candidate.addShare must be a finite non-negative number");
  }
  if (candidate.strategyId) {
    out.perStrategy[candidate.strategyId] =
      (out.perStrategy[candidate.strategyId] ?? 0) + addShare;
  }
  if (candidate.chainId) {
    out.perChain[candidate.chainId] = (out.perChain[candidate.chainId] ?? 0) + addShare;
  }
  if (Array.isArray(candidate.protocolIds)) {
    for (const p of candidate.protocolIds) {
      out.perProtocol[p] = (out.perProtocol[p] ?? 0) + addShare;
    }
  }
  if (candidate.chainId === "bob" && candidate.directHolding === true) {
    out.bobL2DirectShare += addShare;
  }
  return out;
}
