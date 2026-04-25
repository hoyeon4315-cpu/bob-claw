import assert from "node:assert/strict";
import { test } from "node:test";
import { assertStrategyCaps } from "../src/config/strategy-caps.mjs";
import { buildPortfolioExposureState, buildStrategyCapState, evaluateCapCheck } from "../src/executor/policy/cap-check.mjs";

function strategyCapsFixture(overrides = {}) {
  return {
    strategyId: "wrapper-btc-arbitrage",
    autoExecute: true,
    caps: {
      perTxUsd: 100,
      perDayUsd: 300,
      perChainUsd: {
        bob: 150,
        base: 200,
      },
      maxDailyLossUsd: 25,
      maxFailedGasCost24hUsd: 3,
    },
    ...overrides,
  };
}

function intentFixture(overrides = {}) {
  return {
    strategyId: "wrapper-btc-arbitrage",
    chain: "bob",
    mode: "live",
    amountUsd: 40,
    intentType: "swap",
    ...overrides,
  };
}

test("buildStrategyCapState summarizes daily volume and realized pnl", () => {
  const state = buildStrategyCapState({
    strategyId: "wrapper-btc-arbitrage",
    now: "2026-04-16T12:00:00.000Z",
    auditRecords: [
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "bob",
        timestamp: "2026-04-16T01:00:00.000Z",
        amountUsd: 25,
        policyVerdict: "approved",
        realized: { realizedNetPnlUsd: -3, actualKnownCostUsd: 0.4 },
      },
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "base",
        timestamp: "2026-04-16T02:00:00.000Z",
        amountUsd: 15,
        policyVerdict: "approved",
        realized: { realizedNetPnlUsd: 1, actualKnownCostUsd: 0.2 },
      },
    ],
  });

  assert.equal(state.dailyVolumeUsd, 40);
  assert.equal(state.perChainVolumeUsd.bob, 25);
  assert.equal(state.dailyRealizedPnlUsd, -2);
  assert.equal(Number(state.failedGasCost24hUsd.toFixed(6)), 0.6);
});

test("buildStrategyCapState dedupes signed and broadcasted audit records for the same intent", () => {
  const state = buildStrategyCapState({
    strategyId: "wrapper-btc-arbitrage",
    now: "2026-04-16T12:00:00.000Z",
    auditRecords: [
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "bob",
        intentId: "wrapper-btc-arbitrage:bob:abc",
        timestamp: "2026-04-16T01:00:00.000Z",
        amountUsd: 25,
        policyVerdict: "approved",
        lifecycle: { stage: "signed" },
      },
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "bob",
        intentId: "wrapper-btc-arbitrage:bob:abc",
        timestamp: "2026-04-16T01:00:10.000Z",
        amountUsd: 25,
        policyVerdict: "approved",
        lifecycle: { stage: "broadcasted" },
      },
    ],
  });

  assert.equal(state.dailyVolumeUsd, 25);
  assert.equal(state.perChainVolumeUsd.bob, 25);
});

test("buildStrategyCapState prefers reverted audit records over earlier broadcasted records", () => {
  const state = buildStrategyCapState({
    strategyId: "wrapper-btc-arbitrage",
    now: "2026-04-16T12:00:00.000Z",
    auditRecords: [
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "bob",
        intentId: "wrapper-btc-arbitrage:bob:def",
        timestamp: "2026-04-16T01:00:00.000Z",
        amountUsd: 25,
        policyVerdict: "approved",
        lifecycle: { stage: "broadcasted" },
      },
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "bob",
        intentId: "wrapper-btc-arbitrage:bob:def",
        timestamp: "2026-04-16T01:00:10.000Z",
        amountUsd: 25,
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
    ],
  });

  assert.equal(state.dailyVolumeUsd, 0);
  assert.equal(state.perChainVolumeUsd.bob ?? 0, 0);
});

test("evaluateCapCheck blocks amount above per-tx cap", () => {
  const result = evaluateCapCheck({
    intent: intentFixture({ amountUsd: 150 }),
    strategyCaps: strategyCapsFixture(),
    auditRecords: [],
  });

  assert.equal(result.decision, "BLOCK");
  assert.equal(result.blockers.includes("strategy_per_tx_cap_exceeded"), true);
});

test("evaluateCapCheck blocks breached day and chain budgets", () => {
  const result = evaluateCapCheck({
    intent: intentFixture({ amountUsd: 80 }),
    strategyCaps: strategyCapsFixture(),
    auditRecords: [
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "bob",
        timestamp: "2026-04-16T01:00:00.000Z",
        amountUsd: 90,
        policyVerdict: "approved",
      },
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "base",
        timestamp: "2026-04-16T02:00:00.000Z",
        amountUsd: 170,
        policyVerdict: "approved",
      },
    ],
    now: "2026-04-16T12:00:00.000Z",
  });

  assert.equal(result.blockers.includes("strategy_per_day_cap_exceeded"), true);
  assert.equal(result.blockers.includes("strategy_per_chain_cap_exceeded"), true);
});

test("evaluateCapCheck blocks when daily loss cap is already breached", () => {
  const result = evaluateCapCheck({
    intent: intentFixture(),
    strategyCaps: strategyCapsFixture(),
    auditRecords: [
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "bob",
        timestamp: "2026-04-16T01:00:00.000Z",
        amountUsd: 25,
        policyVerdict: "approved",
        realized: { realizedNetPnlUsd: -30, actualKnownCostUsd: 1 },
      },
    ],
    now: "2026-04-16T12:00:00.000Z",
  });

  assert.equal(result.blockers.includes("strategy_max_daily_loss_breached"), true);
});

test("evaluateCapCheck allows emergency unwind to bypass sizing caps", () => {
  const result = evaluateCapCheck({
    intent: intentFixture({
      amountUsd: 500,
      intentType: "emergency_unwind",
      executionReason: "risk_unwind",
    }),
    strategyCaps: strategyCapsFixture(),
    auditRecords: [],
  });

  assert.equal(result.decision, "ALLOW");
});

test("evaluateCapCheck uses capCheckAmountUsd override for internal batched steps", () => {
  const result = evaluateCapCheck({
    intent: intentFixture({
      amountUsd: 300,
      metadata: {
        capCheckAmountUsd: 0,
      },
    }),
    strategyCaps: strategyCapsFixture({
      caps: {
        perTxUsd: 100,
        perDayUsd: 300,
        perChainUsd: {
          bob: 150,
          base: 200,
        },
        maxDailyLossUsd: 25,
        maxFailedGasCost24hUsd: 3,
      },
    }),
    auditRecords: [
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "bob",
        timestamp: "2026-04-16T01:00:00.000Z",
        amountUsd: 90,
        intent: {
          metadata: {
            capCheckAmountUsd: 90,
          },
        },
        policyVerdict: "approved",
      },
    ],
    now: "2026-04-16T12:00:00.000Z",
  });

  assert.equal(result.decision, "ALLOW");
  assert.equal(result.metrics.amountUsd, 300);
  assert.equal(result.metrics.capAmountUsd, 0);
});

test("buildStrategyCapState reinterprets legacy wrapped loop audit steps with internal cap accounting", () => {
  const state = buildStrategyCapState({
    strategyId: "wrapped-btc-loop-base-moonwell",
    now: "2026-04-16T22:00:00.000Z",
    auditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "wrapped-btc-loop-base-moonwell:entry:approve-initial-collateral",
        timestamp: "2026-04-16T20:48:16.619Z",
        amountUsd: 300,
        policyVerdict: "approved",
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "wrapped-btc-loop-base-moonwell:entry:mint-initial-collateral",
        timestamp: "2026-04-16T20:49:16.619Z",
        amountUsd: 300,
        policyVerdict: "approved",
      },
    ],
  });

  assert.equal(state.dailyVolumeUsd, 300);
  assert.equal(state.perChainVolumeUsd.base, 300);
});

test("buildStrategyCapState reinterprets legacy token dex approval audit steps with internal cap accounting", () => {
  const state = buildStrategyCapState({
    strategyId: "token-dex-experiment",
    now: "2026-04-16T22:00:00.000Z",
    auditRecords: [
      {
        strategyId: "token-dex-experiment",
        chain: "base",
        timestamp: "2026-04-16T21:07:31.287Z",
        amountUsd: 7.501189265945548,
        policyVerdict: "approved",
        intent: {
          intentType: "approve_exact",
        },
      },
      {
        strategyId: "token-dex-experiment",
        chain: "base",
        timestamp: "2026-04-16T21:07:36.445Z",
        amountUsd: 7.501189265945548,
        policyVerdict: "rejected",
        intent: {
          intentType: "odos_swap",
        },
        lifecycle: {
          stage: "rejected",
        },
      },
    ],
  });

  assert.equal(state.dailyVolumeUsd, 0);
  assert.equal(state.perChainVolumeUsd.base ?? 0, 0);
});

test("buildPortfolioExposureState aggregates protocol, chain, and BTC-denominated usage", () => {
  const state = buildPortfolioExposureState({
    now: "2026-04-16T22:00:00.000Z",
    auditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "wrapped-btc-loop-base-moonwell:entry:mint-initial-collateral",
        timestamp: "2026-04-16T20:49:16.619Z",
        amountUsd: 120,
        policyVerdict: "approved",
      },
      {
        strategyId: "token-dex-experiment",
        chain: "base",
        timestamp: "2026-04-16T21:07:36.445Z",
        amountUsd: 30,
        policyVerdict: "approved",
      },
    ],
  });

  assert.equal(state.protocolVolumeUsd.moonwell, 120);
  assert.equal(state.protocolVolumeUsd.odos, 150);
  assert.equal(state.chainVolumeUsd.base, 150);
  assert.equal(state.assetFamilyVolumeUsd.btc_wrappers, 120);
  assert.equal(state.btcDenominatedVolumeUsd, 120);
  assert.equal(state.nonBtcDenominatedVolumeUsd, 30);
});

test("evaluateCapCheck blocks aggregate protocol exposure above configured share", () => {
  const result = evaluateCapCheck({
    intent: intentFixture({
      strategyId: "wrapped-btc-loop-base-moonwell",
      chain: "base",
      amountUsd: 20,
      intentId: "wrapped-btc-loop-base-moonwell:entry:mint-initial-collateral",
    }),
    strategyCaps: {
      ...strategyCapsFixture({
        strategyId: "wrapped-btc-loop-base-moonwell",
        caps: {
          perTxUsd: 300,
          perDayUsd: 600,
          perChainUsd: { base: 300 },
          maxDailyLossUsd: 50,
          maxFailedGasCost24hUsd: 3,
        },
      }),
      exposure: {
        protocols: ["moonwell", "odos"],
        assetFamily: "btc_wrappers",
        btcDenominated: true,
      },
    },
    auditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "wrapped-btc-loop-base-moonwell:entry:mint-initial-collateral",
        timestamp: "2026-04-16T01:00:00.000Z",
        amountUsd: 90,
        policyVerdict: "approved",
      },
    ],
    activeBudgetUsd: 400,
    now: "2026-04-16T12:00:00.000Z",
  });

  assert.equal(result.blockers.includes("portfolio_protocol_cap_exceeded"), true);
});

test("evaluateCapCheck blocks aggregate chain exposure and BTC denomination drift", () => {
  const result = evaluateCapCheck({
    intent: intentFixture({
      strategyId: "token-dex-experiment",
      chain: "base",
      amountUsd: 40,
    }),
    strategyCaps: {
      ...strategyCapsFixture({
        strategyId: "token-dex-experiment",
        caps: {
          perTxUsd: 100,
          perDayUsd: 300,
          perChainUsd: { base: 200 },
          maxDailyLossUsd: 25,
          maxFailedGasCost24hUsd: 3,
        },
      }),
      exposure: {
        protocols: ["odos"],
        assetFamily: "mixed_assets",
        btcDenominated: false,
      },
    },
    auditRecords: [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        timestamp: "2026-04-16T01:00:00.000Z",
        amountUsd: 60,
        policyVerdict: "approved",
      },
      {
        strategyId: "token-dex-experiment",
        chain: "base",
        timestamp: "2026-04-16T02:00:00.000Z",
        amountUsd: 30,
        policyVerdict: "approved",
      },
    ],
    activeBudgetUsd: 100,
    now: "2026-04-16T12:00:00.000Z",
  });

  assert.equal(result.blockers.includes("portfolio_chain_cap_exceeded"), true);
  assert.equal(result.blockers.includes("portfolio_btc_denomination_floor_breached"), true);
});

test("buildStrategyCapState ignores prelive fork sign-only audit rows before broadcast", () => {
  const state = buildStrategyCapState({
    strategyId: "prelive_fork_execution",
    now: "2026-04-19T12:00:00.000Z",
    auditRecords: [
      {
        strategyId: "prelive_fork_execution",
        chain: "sonic",
        intentId: "prelive-fork:signed-only",
        timestamp: "2026-04-19T11:00:00.000Z",
        amountUsd: 18.96,
        policyVerdict: "approved",
        lifecycle: { stage: "signed" },
        broadcast: null,
      },
    ],
  });

  assert.equal(state.dailyVolumeUsd, 0);
  assert.equal(state.perChainVolumeUsd.sonic ?? 0, 0);
});

test("recursive wrapped BTC loop caps are declared and reopened for live validation", () => {
  const caps = assertStrategyCaps("recursive_wrapped_btc_lending_loop");

  assert.equal(caps.autoExecute, true);
  assert.equal(caps.caps.perTxUsd, 1_000_000);
  assert.equal(caps.caps.perChainUsd.base, 1_000_000);
  assert.deepEqual(caps.exposure.protocols, ["moonwell", "odos"]);
  assert.equal(caps.exposure.btcDenominated, true);
  assert.equal(caps.leverage.healthFactorMin, 1.35);
  assert.equal(caps.leverage.liquidationBufferPct, 12);

  const liveResult = evaluateCapCheck({
    intent: {
      strategyId: "recursive_wrapped_btc_lending_loop",
      chain: "base",
      mode: "live",
      amountUsd: 300,
      intentType: "lending_loop_entry",
    },
    strategyCaps: caps,
    auditRecords: [],
  });

  assert.equal(liveResult.decision, "ALLOW");
  assert.equal(liveResult.blockers.includes("strategy_auto_execute_disabled"), false);
  assert.equal(liveResult.blockers.includes("strategy_per_tx_cap_missing"), false);
  assert.equal(liveResult.blockers.includes("strategy_per_day_cap_missing"), false);
  assert.equal(liveResult.blockers.includes("strategy_per_chain_cap_missing"), false);

  const dryRunResult = evaluateCapCheck({
    intent: {
      strategyId: "recursive_wrapped_btc_lending_loop",
      chain: "base",
      mode: "dry_run",
      amountUsd: 300,
      intentType: "lending_loop_entry",
    },
    strategyCaps: caps,
    auditRecords: [],
  });

  assert.equal(dryRunResult.decision, "ALLOW");
});

test("Across bridge caps exclude BSC until a chain-local SpokePool is verified", () => {
  const caps = assertStrategyCaps("across-bridge");

  assert.equal(caps.caps.perChainUsd.bsc, undefined);
  assert.equal(caps.caps.perChainUsd.bnb, undefined);

  const result = evaluateCapCheck({
    intent: {
      strategyId: "across-bridge",
      chain: "bsc",
      mode: "live",
      amountUsd: 2,
      intentType: "across_bridge_deposit",
    },
    strategyCaps: caps,
    auditRecords: [],
  });

  assert.equal(result.decision, "BLOCK");
  assert.equal(result.blockers.includes("strategy_per_chain_cap_missing"), true);
});
