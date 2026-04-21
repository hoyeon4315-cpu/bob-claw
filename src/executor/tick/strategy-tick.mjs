// Strategy Tick — end-to-end orchestrator (pure).
//
// Closes the wiring gap between per-strategy adapter evaluators
// (T8..T13) and the dispatcher (T14). One call per tick:
//
//   for each strategy entry:
//     report = entry.evaluate({ config, market, receipts, now })
//   built  = buildDispatcherCandidates(...)
//   result = dispatchStrategyCatalog(...)
//
// Pure function. No I/O, no LLM, no signing. The caller is
// responsible for fetching `market` snapshots (Beefy REST, Pendle
// SDK, on-chain reads, etc.) and for loading receipts. The caller is
// also responsible for taking the returned intents and feeding them
// to the signer daemon — this module only produces them.
//
// Invariants:
// - Every adapter evaluator must return a frozen report with at
//   least { strategyId, mode | shadowReady | liveReady, blockers,
//   economics }. Adapters that throw are caught and turned into a
//   synthetic blocked report; never let one bad adapter take the
//   whole tick down.
// - All BTC math goes through buildDispatcherCandidates → caps,
//   yields, and round-trip costs are sats-first.
// - Output is frozen.

import { buildDispatcherCandidates } from "../dispatcher/candidate-builder.mjs";
import { dispatchStrategyCatalog } from "../dispatcher/strategy-catalog-dispatcher.mjs";

function syntheticBlocked(strategyId, reason) {
  return Object.freeze({
    strategyId: strategyId || null,
    mode: "blocked",
    shadowReady: false,
    liveReady: false,
    blockers: Object.freeze([reason]),
    economics: null,
  });
}

function evaluateOne(entry, now) {
  const { evaluate, config = {}, market = {}, receipts = [] } = entry || {};
  const sid = entry?.strategyId || config?.id || null;
  if (typeof evaluate !== "function") {
    return { report: syntheticBlocked(sid, "evaluator_missing"), error: null };
  }
  try {
    const report = evaluate({ config, market, receipts, now });
    if (!report || typeof report !== "object") {
      return {
        report: syntheticBlocked(sid, "evaluator_returned_non_object"),
        error: null,
      };
    }
    return { report, error: null };
  } catch (err) {
    return {
      report: syntheticBlocked(sid, "evaluator_threw"),
      error: Object.freeze({
        strategyId: sid,
        message: String(err?.message || err),
        name: err?.name || "Error",
      }),
    };
  }
}

export function runStrategyTick({
  entries = [],
  adaptiveCapitalPlan,
  dynamicLiveGate,
  feedFreshness,
  btcPriceUsd,
  allowShadow = false,
  protocolOverrides = null,
  now = new Date().toISOString(),
} = {}) {
  if (!Array.isArray(entries)) {
    throw new TypeError("entries array required");
  }
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

  const reports = [];
  const errors = [];
  const builderInputs = [];
  for (const entry of entries) {
    const { report, error } = evaluateOne(entry, now);
    reports.push(report);
    if (error) errors.push(error);
    builderInputs.push({
      report,
      config: entry?.config,
      protocol: entry?.protocol,
      proposedAllocationSatsOverride: entry?.proposedAllocationSatsOverride,
    });
  }

  const built = buildDispatcherCandidates(builderInputs, {
    btcPriceUsd,
    allowShadow,
    protocolOverrides,
  });

  const dispatch = dispatchStrategyCatalog({
    candidates: [...built.candidates],
    adaptiveCapitalPlan,
    dynamicLiveGate,
    feedFreshness,
    btcPriceUsd,
    now,
  });

  return Object.freeze({
    schemaVersion: 1,
    observedAt: now,
    reports: Object.freeze(reports),
    errors: Object.freeze(errors),
    builder: Object.freeze({
      candidateCount: built.candidates.length,
      skippedCount: built.skipped.length,
      candidates: built.candidates,
      skipped: built.skipped,
    }),
    dispatch,
    summary: Object.freeze({
      strategyCount: entries.length,
      reportCount: reports.length,
      errorCount: errors.length,
      candidateCount: built.candidates.length,
      skippedCount: built.skipped.length,
      allowCount: dispatch.summary?.allowCount ?? 0,
      denyCount: dispatch.summary?.denyCount ?? 0,
      globalBlockReason: dispatch.summary?.globalBlockReason ?? null,
    }),
  });
}
