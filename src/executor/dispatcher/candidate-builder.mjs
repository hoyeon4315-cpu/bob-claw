// Candidate Builder — adapter reports → dispatcher candidates.
//
// Wiring gap closer. Adapters (T8..T13) return pure evaluator reports
// with shape:
//
//   { strategyId, mode, shadowReady, liveReady, blockers, economics, ... }
//
// Dispatcher (T14) consumes a different candidate shape:
//
//   { strategyId, chain, protocol, proposedAllocationSats,
//     expectedYieldSats, roundTripCostSats }
//
// This module is the deterministic bridge. Pure function, no I/O, no
// LLM. Reports with `mode !== "shadow_ready"` and not `liveReady` are
// dropped into `skipped[]` with an explicit reason — never silently
// discarded.
//
// Invariants:
// - BTC sats-first: all economics are converted via btcPriceUsd.
// - Adapter `economics.projectedNetUsd` is already net of all costs
//   (fees, slippage, borrow). We therefore emit it as `expectedYield`
//   and set `roundTripCost=0`, so the dispatcher's `netSats()` still
//   produces the correct net edge. This keeps the dispatcher's math
//   one-way and avoids double-counting.
// - Shadow mode (config.perTradeCapUsd === 0) yields
//   `proposedAllocationSats = 0`. Dispatcher will deny with CAP_ZERO,
//   which is the desired outcome — shadow lanes observe, not deploy.
// - `protocol` is derived from a closed allow-list keyed on
//   `strategyId`. Unknown ids are *skipped* (not guessed), because
//   diversification `perProtocolMaxShare` is a policy surface and
//   must not silently bucket into a wrong protocol.

const STRATEGY_PROTOCOL = Object.freeze({
  "pendle-pt-lbtc-base": "pendle",
  "pendle-pt-solvbtc-bbn-bsc": "pendle",
  "aerodrome-cl-base": "aerodrome",
  "berachain-bend-bex-bgt": "berachain-bend-bex",
  "gmx-v2-perp-basis-avax": "gmx-v2",
  "beefy-folding-vault": "beefy",
  "defillama-yield-portfolio": "defillama",
  "wrapped-btc-loop-base-moonwell": "moonwell",
  "recursive_wrapped_btc_lending_loop": "moonwell",
});

function usdToSats(usd, btcPriceUsd) {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  if (!Number.isFinite(btcPriceUsd) || btcPriceUsd <= 0) return 0;
  const btc = usd / btcPriceUsd;
  return Math.floor(btc * 1e8);
}

function resolveChain(report, config) {
  if (typeof report?.chain === "string" && report.chain) return report.chain;
  if (typeof config?.chain === "string" && config.chain) return config.chain;
  return null;
}

function resolveProtocol(strategyId, overrideMap) {
  if (overrideMap && typeof overrideMap === "object") {
    const v = overrideMap[strategyId];
    if (typeof v === "string" && v) return v;
  }
  const v = STRATEGY_PROTOCOL[strategyId];
  return typeof v === "string" && v ? v : null;
}

function classifyMode(report) {
  if (report?.liveReady === true) return "live_candidate";
  if (report?.shadowReady === true) return "shadow_ready";
  return "blocked";
}

/**
 * @param {Array<{
 *   report: object,
 *   config: object,
 *   protocol?: string,
 *   proposedAllocationSatsOverride?: number
 * }>} inputs
 * @param {{
 *   btcPriceUsd: number,
 *   protocolOverrides?: Record<string,string>,
 *   allowShadow?: boolean,  // if true, shadow_ready reports still emit a candidate
 * }} opts
 */
export function buildDispatcherCandidates(inputs = [], opts = {}) {
  if (!Array.isArray(inputs)) {
    throw new TypeError("inputs array required");
  }
  const { btcPriceUsd, protocolOverrides = null, allowShadow = false } = opts;
  if (!Number.isFinite(btcPriceUsd) || btcPriceUsd <= 0) {
    throw new TypeError("btcPriceUsd must be a positive finite number");
  }

  const candidates = [];
  const skipped = [];

  for (const entry of inputs) {
    const report = entry?.report;
    const config = entry?.config;
    if (!report || typeof report !== "object") {
      skipped.push(Object.freeze({
        strategyId: null,
        reason: "report_missing",
      }));
      continue;
    }
    const strategyId = report.strategyId;
    if (typeof strategyId !== "string" || !strategyId) {
      skipped.push(Object.freeze({
        strategyId: null,
        reason: "strategy_id_missing",
      }));
      continue;
    }

    const mode = classifyMode(report);
    if (mode === "blocked") {
      skipped.push(Object.freeze({
        strategyId,
        reason: "adapter_blocked",
        topBlocker: Array.isArray(report.blockers) ? report.blockers[0] ?? null : null,
      }));
      continue;
    }
    if (mode === "shadow_ready" && !allowShadow) {
      skipped.push(Object.freeze({
        strategyId,
        reason: "shadow_only",
      }));
      continue;
    }

    const chain = resolveChain(report, config);
    if (!chain) {
      skipped.push(Object.freeze({
        strategyId,
        reason: "chain_unknown",
      }));
      continue;
    }

    const protocol = resolveProtocol(strategyId, {
      ...(protocolOverrides || {}),
      ...(entry.protocol ? { [strategyId]: entry.protocol } : {}),
    });
    if (!protocol) {
      skipped.push(Object.freeze({
        strategyId,
        reason: "protocol_unknown",
      }));
      continue;
    }

    const projectedNetUsd = Number(report?.economics?.projectedNetUsd);
    const expectedYieldSats = usdToSats(projectedNetUsd, btcPriceUsd);

    const perTradeCapUsd = Number(config?.perTradeCapUsd ?? 0);
    const capSats = usdToSats(perTradeCapUsd, btcPriceUsd);
    const proposedAllocationSats = Number.isFinite(entry?.proposedAllocationSatsOverride)
      && entry.proposedAllocationSatsOverride >= 0
      ? Math.floor(entry.proposedAllocationSatsOverride)
      : capSats;

    candidates.push(Object.freeze({
      strategyId,
      chain,
      protocol,
      proposedAllocationSats,
      expectedYieldSats,
      roundTripCostSats: 0,
      sourceMode: mode,
    }));
  }

  return Object.freeze({
    candidates: Object.freeze(candidates),
    skipped: Object.freeze(skipped),
  });
}

export { STRATEGY_PROTOCOL };
