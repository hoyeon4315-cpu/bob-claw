import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runStrategyTick } from "../src/executor/tick/strategy-tick.mjs";

const BTC = 60_000;

const baseGates = {
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
      {
        strategyId: "beefy-folding-vault",
        autoExecute: true,
        newEntriesAllowed: true,
        effectiveCapsUsd: { perTxUsd: 200, perDayUsd: 800 },
        bindingConstraint: { perTxUsd: "static_cap" },
      },
    ],
  },
  feedFreshness: { ok: true, worstSeverity: "ok", staleCount: 0 },
  btcPriceUsd: BTC,
};

function liveEvaluator() {
  return ({ config }) =>
    Object.freeze({
      strategyId: config.id,
      chain: "base",
      mode: "live_candidate",
      shadowReady: true,
      liveReady: true,
      blockers: [],
      economics: { projectedNetUsd: 120 },
    });
}

function blockedEvaluator() {
  return ({ config }) =>
    Object.freeze({
      strategyId: config.id,
      chain: "base",
      mode: "blocked",
      shadowReady: false,
      liveReady: false,
      blockers: ["market_missing_apy"],
      economics: null,
    });
}

describe("strategy-tick", () => {
  test("rejects bad arguments", () => {
    assert.throws(() => runStrategyTick({ ...baseGates, entries: null }));
    assert.throws(() =>
      runStrategyTick({ ...baseGates, btcPriceUsd: 0, entries: [] }),
    );
    assert.throws(() =>
      runStrategyTick({ entries: [], feedFreshness: baseGates.feedFreshness, btcPriceUsd: BTC }),
    );
  });

  test("evaluates entries → builds candidates → dispatches allow", () => {
    const result = runStrategyTick({
      ...baseGates,
      entries: [
        {
          evaluate: liveEvaluator(),
          config: { id: "pendle-pt-lbtc-base", perTradeCapUsd: 300 },
        },
      ],
      now: "2026-04-21T00:00:00Z",
    });
    assert.equal(result.summary.strategyCount, 1);
    assert.equal(result.summary.reportCount, 1);
    assert.equal(result.summary.errorCount, 0);
    assert.equal(result.summary.candidateCount, 1);
    assert.equal(result.summary.allowCount, 1);
    assert.equal(result.dispatch.intents[0].decision, "allow");
    assert.equal(result.dispatch.intents[0].strategyId, "pendle-pt-lbtc-base");
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.reports));
    assert.ok(Object.isFrozen(result.builder));
  });

  test("blocked adapter goes to skipped, not dispatched", () => {
    const result = runStrategyTick({
      ...baseGates,
      entries: [
        {
          evaluate: blockedEvaluator(),
          config: { id: "beefy-folding-vault", perTradeCapUsd: 200 },
        },
      ],
    });
    assert.equal(result.summary.candidateCount, 0);
    assert.equal(result.summary.skippedCount, 1);
    assert.equal(result.builder.skipped[0].reason, "adapter_blocked");
    assert.equal(result.builder.skipped[0].topBlocker, "market_missing_apy");
    assert.equal(result.summary.allowCount, 0);
  });

  test("missing evaluator becomes synthetic blocked, no throw", () => {
    const result = runStrategyTick({
      ...baseGates,
      entries: [
        {
          config: { id: "pendle-pt-lbtc-base", perTradeCapUsd: 300 },
        },
      ],
    });
    assert.equal(result.reports[0].blockers[0], "evaluator_missing");
    assert.equal(result.summary.candidateCount, 0);
    assert.equal(result.summary.errorCount, 0);
  });

  test("throwing evaluator captured into errors[], does not break tick", () => {
    const result = runStrategyTick({
      ...baseGates,
      entries: [
        {
          evaluate: () => {
            throw new Error("boom");
          },
          config: { id: "pendle-pt-lbtc-base", perTradeCapUsd: 300 },
        },
        {
          evaluate: liveEvaluator(),
          config: { id: "beefy-folding-vault", perTradeCapUsd: 200 },
        },
      ],
    });
    assert.equal(result.summary.errorCount, 1);
    assert.equal(result.errors[0].message, "boom");
    assert.equal(result.errors[0].strategyId, "pendle-pt-lbtc-base");
    assert.equal(result.summary.candidateCount, 1);
    assert.equal(result.dispatch.intents[0].strategyId, "beefy-folding-vault");
  });

  test("feed_stale gate from dispatcher propagates as block_all", () => {
    const result = runStrategyTick({
      ...baseGates,
      feedFreshness: { ok: false, worstSeverity: "stale", staleCount: 2 },
      entries: [
        {
          evaluate: liveEvaluator(),
          config: { id: "pendle-pt-lbtc-base", perTradeCapUsd: 300 },
        },
      ],
    });
    assert.equal(result.dispatch.globalGate.action, "block_all");
    assert.equal(result.summary.allowCount, 0);
    assert.equal(result.summary.globalBlockReason, "feed_stale");
  });

  test("allowShadow=false drops shadow_ready into skipped", () => {
    const result = runStrategyTick({
      ...baseGates,
      entries: [
        {
          evaluate: ({ config }) =>
            Object.freeze({
              strategyId: config.id,
              chain: "base",
              mode: "shadow_ready",
              shadowReady: true,
              liveReady: false,
              blockers: [],
              economics: { projectedNetUsd: 80 },
            }),
          config: { id: "beefy-folding-vault", perTradeCapUsd: 0 },
        },
      ],
    });
    assert.equal(result.summary.candidateCount, 0);
    assert.equal(result.builder.skipped[0].reason, "shadow_only");
  });

  test("gas bootstrap: live_candidate with insufficient gas → bootstrap_pending", () => {
    const result = runStrategyTick({
      ...baseGates,
      entries: [
        {
          evaluate: ({ config }) =>
            Object.freeze({
              strategyId: config.id,
              chain: "base",
              mode: "live_candidate",
              shadowReady: true,
              liveReady: true,
              blockers: [],
              economics: { projectedNetUsd: 120 },
              intent: { chain: "base", amountUsd: 100 },
            }),
          config: { id: "recursive_stablecoin_lending_loop", perTradeCapUsd: 300 },
          gasFloats: { base: { actualWei: "0", targetWei: "1000000000000000000" } },
          hopCatalog: [
            { from: { chain: "ethereum", asset: "ETH" }, to: { chain: "base", asset: "ETH" }, kind: "gas_topup", estimatedFeeBps: 5 },
          ],
        },
      ],
    });
    assert.equal(result.reports[0].mode, "bootstrap_pending");
    assert.equal(result.reports[0].bootstrapStatus.status, "bootstrap_required_before_execution");
    assert.equal(result.summary.bootstrapPendingCount, 1);
    assert.equal(result.summary.bootstrapFailedCount, 0);
    assert.equal(result.summary.microCanaryNotStartedCount, 1);
  });

  test("gas sufficient → no bootstrap, candidate proceeds", () => {
    const result = runStrategyTick({
      ...baseGates,
      entries: [
        {
          evaluate: ({ config }) =>
            Object.freeze({
              strategyId: config.id,
              chain: "base",
              mode: "live_candidate",
              shadowReady: true,
              liveReady: true,
              blockers: [],
              economics: { projectedNetUsd: 120 },
              intent: { chain: "base", amountUsd: 100 },
            }),
          config: { id: "recursive_wrapped_btc_lending_loop", perTradeCapUsd: 300 },
          gasFloats: { base: { actualWei: "5000000000000000000", targetWei: "1000000000000000000" } },
          hopCatalog: [],
        },
      ],
    });
    assert.equal(result.reports[0].mode, "live_candidate");
    assert.equal(result.reports[0].bootstrapStatus == null, true);
    assert.equal(result.summary.bootstrapPendingCount, 0);
  });
});
