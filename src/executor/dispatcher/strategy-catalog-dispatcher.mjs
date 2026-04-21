// Strategy Catalog Dispatcher.
//
// Plan §5b.3 T14. Single integration point that turns a catalog of
// candidate strategy proposals into a ranked list of deploy intents.
// Combines four previously-built gates:
//
//   1. Adaptive capital plan     (T4)  — per-strategy effective caps
//   2. Diversification KPI slice (T15) — HHI/per-chain/per-protocol shares
//   3. Dynamic live gate         (T6)  — verdict horizon + revalidation freshness
//   4. Feed freshness            (T22) — gas/oracle/inventory/TVL watchdog
//
// Pure function. No I/O, no LLM. Callers (Capital Manager tick,
// Signer Daemon preflight) consume the frozen output as the authoritative
// dispatch decision for the current tick. Caps never raised here —
// only shrunk. Denies are explicit and carry a reason code.
//
// Candidate shape:
//   {
//     strategyId,              // must match adaptiveCapitalPlan.strategies[].strategyId
//     chain,                   // Gateway-official chain id
//     protocol,                // e.g. "moonwell", "compound"
//     proposedAllocationSats,  // number of sats requested
//     expectedYieldSats,       // per-period, BTC-denominated
//     roundTripCostSats,       // onramp + dest gas + offramp + slippage
//   }

const DENY_REASONS = Object.freeze({
  FEED_STALE: "feed_stale",
  LIVE_GATE_BLOCKED: "live_gate_blocked",
  OPERATING_FLOOR: "below_operating_floor",
  UNKNOWN_STRATEGY: "unknown_strategy",
  AUTO_EXECUTE_OFF: "auto_execute_off",
  NEW_ENTRIES_BLOCKED: "new_entries_blocked",
  NEGATIVE_EDGE: "negative_post_cost_edge",
  CAP_ZERO: "effective_cap_zero",
  DIVERSIFICATION_VIOLATED: "diversification_violated",
});

function finitePositive(v) {
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function satsFromUsd(usd, btcPriceUsd) {
  if (!(Number.isFinite(usd) && usd > 0)) return 0;
  if (!(Number.isFinite(btcPriceUsd) && btcPriceUsd > 0)) return 0;
  const btc = usd / btcPriceUsd;
  return Math.floor(btc * 1e8);
}

function netSats(candidate) {
  const y = finitePositive(candidate.expectedYieldSats);
  const c = finitePositive(candidate.roundTripCostSats);
  return y - c;
}

// Project per-dimension share that would result if `addSats` were
// deployed. Returns new fractional share for (key=value).
function projectedShare(currentMap, totalSats, key, addSats) {
  const current = finitePositive(currentMap?.[key]);
  const denom = finitePositive(totalSats) + finitePositive(addSats);
  if (denom <= 0) return 0;
  return (current + addSats) / denom;
}

function wouldViolateDiversification({
  candidate,
  addSats,
  absoluteAllocations,
  diversificationSlice,
}) {
  if (!diversificationSlice?.policy) return null;
  const policy = diversificationSlice.policy;
  const perChain = absoluteAllocations?.perChain || {};
  const perProtocol = absoluteAllocations?.perProtocol || {};
  const perStrategy = absoluteAllocations?.perStrategy || {};

  let total = 0;
  for (const v of Object.values(perStrategy)) total += finitePositive(v);

  const projStrategy = projectedShare(perStrategy, total, candidate.strategyId, addSats);
  if (policy.perStrategyMaxShare && projStrategy > policy.perStrategyMaxShare) {
    return {
      dimension: "strategy",
      share: projStrategy,
      max: policy.perStrategyMaxShare,
    };
  }
  const projChain = projectedShare(perChain, total, candidate.chain, addSats);
  if (policy.perChainMaxShare && projChain > policy.perChainMaxShare) {
    return { dimension: "chain", share: projChain, max: policy.perChainMaxShare };
  }
  const projProtocol = projectedShare(perProtocol, total, candidate.protocol, addSats);
  if (policy.perProtocolMaxShare && projProtocol > policy.perProtocolMaxShare) {
    return { dimension: "protocol", share: projProtocol, max: policy.perProtocolMaxShare };
  }
  return null;
}

function shrinkToDiversification({
  candidate,
  requestedSats,
  absoluteAllocations,
  diversificationSlice,
}) {
  let lo = 0;
  let hi = finitePositive(requestedSats);
  if (hi === 0) return 0;
  for (let i = 0; i < 40; i += 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid === lo) break;
    const v = wouldViolateDiversification({
      candidate,
      addSats: mid,
      absoluteAllocations,
      diversificationSlice,
    });
    if (v) hi = mid;
    else lo = mid;
  }
  return lo;
}

function denyAll(candidates, reason, detail, observedAt) {
  return candidates.map((c) =>
    Object.freeze({
      strategyId: c.strategyId,
      chain: c.chain,
      protocol: c.protocol,
      decision: "deny",
      reason,
      detail: detail == null ? null : detail,
      allowedAllocationSats: 0,
      expectedNetSats: netSats(c),
      observedAt,
    }),
  );
}

function buildIntent(candidate, decision, reason, allowedSats, detail, observedAt) {
  return {
    strategyId: candidate.strategyId,
    chain: candidate.chain,
    protocol: candidate.protocol,
    decision,
    reason,
    detail: detail == null ? null : detail,
    allowedAllocationSats: Math.floor(finitePositive(allowedSats)),
    expectedNetSats: netSats(candidate),
    observedAt,
  };
}

function summarize(intents, totalCandidates, globalBlockReason) {
  const allow = intents.filter((i) => i.decision === "allow");
  const deny = intents.filter((i) => i.decision === "deny");
  return Object.freeze({
    totalCandidates,
    allowCount: allow.length,
    denyCount: deny.length || (globalBlockReason ? totalCandidates : 0),
    globalBlockReason,
    totalAllowedSats: allow.reduce(
      (acc, i) => acc + (i.allowedAllocationSats || 0),
      0,
    ),
    totalExpectedNetSats: allow.reduce(
      (acc, i) => acc + Math.max(0, i.expectedNetSats || 0),
      0,
    ),
  });
}

export function dispatchStrategyCatalog({
  candidates = [],
  adaptiveCapitalPlan,
  diversificationSlice = null,
  absoluteAllocations = null,
  dynamicLiveGate,
  feedFreshness,
  btcPriceUsd,
  now = new Date().toISOString(),
} = {}) {
  if (!adaptiveCapitalPlan) {
    throw new TypeError("adaptiveCapitalPlan is required");
  }
  if (!dynamicLiveGate) {
    throw new TypeError("dynamicLiveGate is required");
  }
  if (!feedFreshness) {
    throw new TypeError("feedFreshness is required");
  }
  if (!Number.isFinite(btcPriceUsd) || btcPriceUsd <= 0) {
    throw new TypeError("btcPriceUsd must be a positive finite number");
  }

  if (feedFreshness.ok !== true) {
    return Object.freeze({
      schemaVersion: 1,
      observedAt: now,
      globalGate: Object.freeze({
        action: "block_all",
        reason: DENY_REASONS.FEED_STALE,
        detail: `worstSeverity=${feedFreshness.worstSeverity}; stale=${feedFreshness.staleCount}`,
      }),
      intents: Object.freeze(
        denyAll(candidates, DENY_REASONS.FEED_STALE, feedFreshness.worstSeverity, now),
      ),
      summary: summarize([], candidates.length, "feed_stale"),
    });
  }
  if (dynamicLiveGate.gated === true) {
    return Object.freeze({
      schemaVersion: 1,
      observedAt: now,
      globalGate: Object.freeze({
        action: "block_all",
        reason: DENY_REASONS.LIVE_GATE_BLOCKED,
        detail: JSON.stringify(dynamicLiveGate.blockers || []),
      }),
      intents: Object.freeze(
        denyAll(candidates, DENY_REASONS.LIVE_GATE_BLOCKED, dynamicLiveGate.blockers, now),
      ),
      summary: summarize([], candidates.length, "live_gate_blocked"),
    });
  }
  if (adaptiveCapitalPlan.newEntriesAllowed !== true) {
    return Object.freeze({
      schemaVersion: 1,
      observedAt: now,
      globalGate: Object.freeze({
        action: "block_all",
        reason: DENY_REASONS.OPERATING_FLOOR,
        detail: `belowOperatingFloor=${adaptiveCapitalPlan.belowOperatingFloor}`,
      }),
      intents: Object.freeze(
        denyAll(candidates, DENY_REASONS.OPERATING_FLOOR, null, now),
      ),
      summary: summarize([], candidates.length, "below_operating_floor"),
    });
  }

  const strategyIndex = new Map(
    (adaptiveCapitalPlan.strategies || []).map((s) => [s.strategyId, s]),
  );

  const intents = [];
  for (const candidate of candidates) {
    const s = strategyIndex.get(candidate.strategyId);
    if (!s) {
      intents.push(buildIntent(candidate, "deny", DENY_REASONS.UNKNOWN_STRATEGY, 0, null, now));
      continue;
    }
    if (!s.autoExecute) {
      intents.push(buildIntent(candidate, "deny", DENY_REASONS.AUTO_EXECUTE_OFF, 0, null, now));
      continue;
    }
    if (!s.newEntriesAllowed) {
      intents.push(buildIntent(candidate, "deny", DENY_REASONS.NEW_ENTRIES_BLOCKED, 0, null, now));
      continue;
    }
    const edge = netSats(candidate);
    if (edge <= 0) {
      intents.push(
        buildIntent(candidate, "deny", DENY_REASONS.NEGATIVE_EDGE, 0, { edge }, now),
      );
      continue;
    }

    const perTxSats = satsFromUsd(s.effectiveCapsUsd.perTxUsd, btcPriceUsd);
    const perDaySats = satsFromUsd(s.effectiveCapsUsd.perDayUsd, btcPriceUsd);
    const hardCapSats = Math.min(perTxSats, perDaySats);
    if (hardCapSats <= 0) {
      intents.push(buildIntent(candidate, "deny", DENY_REASONS.CAP_ZERO, 0, null, now));
      continue;
    }

    const requested = finitePositive(candidate.proposedAllocationSats);
    let capped = Math.min(requested, hardCapSats);

    if (diversificationSlice && absoluteAllocations) {
      const violation = wouldViolateDiversification({
        candidate,
        addSats: capped,
        absoluteAllocations,
        diversificationSlice,
      });
      if (violation) {
        const shrunk = shrinkToDiversification({
          candidate,
          requestedSats: capped,
          absoluteAllocations,
          diversificationSlice,
        });
        if (shrunk <= 0) {
          intents.push(
            buildIntent(
              candidate,
              "deny",
              DENY_REASONS.DIVERSIFICATION_VIOLATED,
              0,
              violation,
              now,
            ),
          );
          continue;
        }
        capped = shrunk;
      }
    }

    intents.push(
      buildIntent(
        candidate,
        "allow",
        null,
        capped,
        {
          hardCapSats,
          requestedSats: requested,
          bindingConstraint:
            capped === hardCapSats
              ? s.bindingConstraint.perTxUsd
              : capped === requested
                ? "request"
                : "diversification",
        },
        now,
      ),
    );
  }

  intents.sort((a, b) => {
    if (a.decision !== b.decision) return a.decision === "allow" ? -1 : 1;
    return (b.expectedNetSats || 0) - (a.expectedNetSats || 0);
  });

  return Object.freeze({
    schemaVersion: 1,
    observedAt: now,
    globalGate: Object.freeze({ action: "pass", reason: null, detail: null }),
    intents: Object.freeze(intents.map(Object.freeze)),
    summary: summarize(intents, candidates.length, null),
  });
}

export { DENY_REASONS };
