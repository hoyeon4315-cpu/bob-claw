import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildDispatcherCandidates,
  STRATEGY_PROTOCOL,
} from "../src/executor/dispatcher/candidate-builder.mjs";
import { dispatchStrategyCatalog } from "../src/executor/dispatcher/strategy-catalog-dispatcher.mjs";

const BTC = 60_000;

function liveReport(overrides = {}) {
  return {
    strategyId: "pendle-pt-lbtc-base",
    chain: "base",
    mode: "live_candidate",
    shadowReady: true,
    liveReady: true,
    blockers: [],
    economics: { projectedNetUsd: 120 },
    ...overrides,
  };
}

function shadowReport(overrides = {}) {
  return {
    strategyId: "aerodrome-cl-base",
    chain: "base",
    mode: "shadow_ready",
    shadowReady: true,
    liveReady: false,
    blockers: [],
    economics: { projectedNetUsd: 50 },
    ...overrides,
  };
}

function blockedReport(overrides = {}) {
  return {
    strategyId: "gmx-v2-perp-basis-avax",
    chain: "avalanche",
    mode: "blocked",
    shadowReady: false,
    liveReady: false,
    blockers: ["config_invalid"],
    economics: null,
    ...overrides,
  };
}

describe("candidate-builder", () => {
  test("rejects invalid inputs", () => {
    assert.throws(() => buildDispatcherCandidates(null, { btcPriceUsd: 60_000 }));
    assert.throws(() => buildDispatcherCandidates([], {}));
    assert.throws(() => buildDispatcherCandidates([], { btcPriceUsd: 0 }));
    assert.throws(() => buildDispatcherCandidates([], { btcPriceUsd: -1 }));
  });

  test("emits live candidate with sats conversion", () => {
    const out = buildDispatcherCandidates(
      [{ report: liveReport(), config: { perTradeCapUsd: 300 } }],
      { btcPriceUsd: BTC },
    );
    assert.equal(out.candidates.length, 1);
    assert.equal(out.skipped.length, 0);
    const c = out.candidates[0];
    assert.equal(c.strategyId, "pendle-pt-lbtc-base");
    assert.equal(c.chain, "base");
    assert.equal(c.protocol, "pendle");
    // 300 USD / 60k = 0.005 BTC = 500_000 sats
    assert.equal(c.proposedAllocationSats, 500_000);
    // 120 USD / 60k = 0.002 BTC = 200_000 sats
    assert.equal(c.expectedYieldSats, 200_000);
    assert.equal(c.roundTripCostSats, 0);
    assert.equal(c.sourceMode, "live_candidate");
    assert.ok(Object.isFrozen(c));
  });

  test("shadow-only reports skipped by default", () => {
    const out = buildDispatcherCandidates(
      [{ report: shadowReport(), config: { perTradeCapUsd: 0 } }],
      { btcPriceUsd: BTC },
    );
    assert.equal(out.candidates.length, 0);
    assert.equal(out.skipped.length, 1);
    assert.equal(out.skipped[0].strategyId, "aerodrome-cl-base");
    assert.equal(out.skipped[0].reason, "shadow_only");
  });

  test("shadow-only reports emitted when allowShadow=true", () => {
    const out = buildDispatcherCandidates(
      [{ report: shadowReport(), config: { perTradeCapUsd: 0 } }],
      { btcPriceUsd: BTC, allowShadow: true },
    );
    assert.equal(out.candidates.length, 1);
    assert.equal(out.candidates[0].proposedAllocationSats, 0);
    assert.equal(out.candidates[0].sourceMode, "shadow_ready");
  });

  test("blocked reports skipped with top blocker", () => {
    const out = buildDispatcherCandidates(
      [{ report: blockedReport(), config: {} }],
      { btcPriceUsd: BTC },
    );
    assert.equal(out.candidates.length, 0);
    assert.equal(out.skipped.length, 1);
    assert.equal(out.skipped[0].reason, "adapter_blocked");
    assert.equal(out.skipped[0].topBlocker, "config_invalid");
  });

  test("unknown strategyId routes to protocol_unknown skip", () => {
    const out = buildDispatcherCandidates(
      [{ report: liveReport({ strategyId: "phantom-strategy" }), config: { perTradeCapUsd: 100 } }],
      { btcPriceUsd: BTC },
    );
    assert.equal(out.candidates.length, 0);
    assert.equal(out.skipped[0].reason, "protocol_unknown");
  });

  test("explicit protocol override wins over map", () => {
    const out = buildDispatcherCandidates(
      [
        {
          report: liveReport({ strategyId: "custom-id" }),
          config: { perTradeCapUsd: 100 },
          protocol: "custom-protocol",
        },
      ],
      { btcPriceUsd: BTC },
    );
    assert.equal(out.candidates.length, 1);
    assert.equal(out.candidates[0].protocol, "custom-protocol");
  });

  test("missing chain is skipped, not guessed", () => {
    const out = buildDispatcherCandidates(
      [{ report: liveReport({ chain: null }), config: {} }],
      { btcPriceUsd: BTC },
    );
    assert.equal(out.candidates.length, 0);
    assert.equal(out.skipped[0].reason, "chain_unknown");
  });

  test("missing strategyId is skipped", () => {
    const out = buildDispatcherCandidates(
      [{ report: { ...liveReport(), strategyId: null }, config: {} }],
      { btcPriceUsd: BTC },
    );
    assert.equal(out.candidates[0], undefined);
    assert.equal(out.skipped[0].reason, "strategy_id_missing");
  });

  test("missing report is skipped", () => {
    const out = buildDispatcherCandidates([{ report: null }], { btcPriceUsd: BTC });
    assert.equal(out.skipped[0].reason, "report_missing");
  });

  test("proposedAllocationSatsOverride wins over config", () => {
    const out = buildDispatcherCandidates(
      [
        {
          report: liveReport(),
          config: { perTradeCapUsd: 300 },
          proposedAllocationSatsOverride: 42_000,
        },
      ],
      { btcPriceUsd: BTC },
    );
    assert.equal(out.candidates[0].proposedAllocationSats, 42_000);
  });

  test("STRATEGY_PROTOCOL covers all T8..T13 + legacy lending", () => {
    assert.equal(STRATEGY_PROTOCOL["pendle-pt-lbtc-base"], "pendle");
    assert.equal(STRATEGY_PROTOCOL["pendle-pt-solvbtc-bbn-bsc"], "pendle");
    assert.equal(STRATEGY_PROTOCOL["aerodrome-cl-base"], "aerodrome");
    assert.equal(STRATEGY_PROTOCOL["berachain-bend-bex-bgt"], "berachain-bend-bex");
    assert.equal(STRATEGY_PROTOCOL["gmx-v2-perp-basis-avax"], "gmx-v2");
    assert.equal(STRATEGY_PROTOCOL["beefy-folding-vault"], "beefy");
    assert.equal(STRATEGY_PROTOCOL["wrapped-btc-loop-base-moonwell"], "moonwell");
    assert.ok(Object.isFrozen(STRATEGY_PROTOCOL));
  });

  test("builder output is frozen and feeds dispatcher end-to-end", () => {
    const built = buildDispatcherCandidates(
      [
        { report: liveReport(), config: { perTradeCapUsd: 300 } },
        { report: blockedReport(), config: {} },
      ],
      { btcPriceUsd: BTC },
    );
    assert.ok(Object.isFrozen(built));
    assert.ok(Object.isFrozen(built.candidates));
    assert.ok(Object.isFrozen(built.skipped));

    const dispatchResult = dispatchStrategyCatalog({
      candidates: [...built.candidates],
      adaptiveCapitalPlan: {
        newEntriesAllowed: true,
        strategies: [
          {
            strategyId: "pendle-pt-lbtc-base",
            autoExecute: true,
            newEntriesAllowed: true,
            effectiveCapsUsd: { perTxUsd: 500, perDayUsd: 2000 },
            bindingConstraint: { perTxUsd: "static_cap" },
          },
        ],
      },
      dynamicLiveGate: { gated: false, blockers: [] },
      feedFreshness: { ok: true, worstSeverity: "ok", staleCount: 0 },
      btcPriceUsd: BTC,
    });
    assert.equal(dispatchResult.summary.allowCount, 1);
    assert.equal(dispatchResult.intents[0].decision, "allow");
    assert.equal(dispatchResult.intents[0].strategyId, "pendle-pt-lbtc-base");
  });
});
