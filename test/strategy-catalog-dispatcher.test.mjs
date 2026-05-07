import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dispatchStrategyCatalog,
  DENY_REASONS,
} from "../src/executor/dispatcher/strategy-catalog-dispatcher.mjs";

const BTC_PRICE = 100_000; // USD/BTC, convenient scaler

// Build an adaptive capital plan skeleton the dispatcher can consume.
function plan({ newEntriesAllowed = true, strategies } = {}) {
  return Object.freeze({
    schemaVersion: 1,
    belowOperatingFloor: !newEntriesAllowed,
    newEntriesAllowed,
    strategies: (strategies || []).map((s) =>
      Object.freeze({
        strategyId: s.strategyId,
        autoExecute: s.autoExecute !== false,
        newEntriesAllowed: s.newEntriesAllowed !== false,
        effectiveCapsUsd: Object.freeze({
          perTxUsd: s.perTxUsd ?? 500,
          perDayUsd: s.perDayUsd ?? 2000,
          maxDailyLossUsd: s.maxDailyLossUsd ?? 100,
        }),
        bindingConstraint: Object.freeze({
          perTxUsd: s.bindPerTx ?? "static",
          perDayUsd: s.bindPerDay ?? "static",
        }),
      }),
    ),
  });
}

const freshFeeds = Object.freeze({
  ok: true,
  action: "continue",
  worstSeverity: null,
  staleCount: 0,
});
const staleFeeds = Object.freeze({
  ok: false,
  action: "halt_new_entries",
  worstSeverity: "HALT_STRATEGY",
  staleCount: 1,
});

const candidateA = Object.freeze({
  strategyId: "S1_moonwell_base",
  chain: "base",
  protocol: "moonwell",
  proposedAllocationSats: 5_000_000,
  expectedYieldSats: 50_000,
  roundTripCostSats: 10_000,
});

test("throws when required inputs missing", () => {
  assert.throws(() => dispatchStrategyCatalog({}), /adaptiveCapitalPlan/);
  assert.throws(
    () =>
      dispatchStrategyCatalog({
        adaptiveCapitalPlan: plan({ strategies: [] }),
      }),
    /feedFreshness/,
  );
  assert.throws(
    () =>
      dispatchStrategyCatalog({
        adaptiveCapitalPlan: plan({ strategies: [] }),
        feedFreshness: freshFeeds,
        btcPriceUsd: 0,
      }),
    /btcPriceUsd/,
  );
});

test("stale feeds block all candidates", () => {
  const out = dispatchStrategyCatalog({
    candidates: [candidateA],
    adaptiveCapitalPlan: plan({ strategies: [{ strategyId: "S1_moonwell_base" }] }),
    feedFreshness: staleFeeds,
    btcPriceUsd: BTC_PRICE,
  });
  assert.equal(out.globalGate.action, "block_all");
  assert.equal(out.globalGate.reason, DENY_REASONS.FEED_STALE);
  assert.equal(out.intents.length, 1);
  assert.equal(out.intents[0].decision, "deny");
  assert.equal(out.intents[0].reason, DENY_REASONS.FEED_STALE);
});

test("operating floor breach denies all", () => {
  const out = dispatchStrategyCatalog({
    candidates: [candidateA],
    adaptiveCapitalPlan: plan({
      newEntriesAllowed: false,
      strategies: [{ strategyId: "S1_moonwell_base" }],
    }),
    feedFreshness: freshFeeds,
    btcPriceUsd: BTC_PRICE,
  });
  assert.equal(out.globalGate.reason, DENY_REASONS.OPERATING_FLOOR);
});

test("unknown strategy is denied, others pass", () => {
  const unknown = { ...candidateA, strategyId: "S_not_in_catalog" };
  const out = dispatchStrategyCatalog({
    candidates: [unknown, candidateA],
    adaptiveCapitalPlan: plan({ strategies: [{ strategyId: "S1_moonwell_base" }] }),
    feedFreshness: freshFeeds,
    btcPriceUsd: BTC_PRICE,
  });
  const denied = out.intents.find((i) => i.strategyId === "S_not_in_catalog");
  assert.equal(denied.decision, "deny");
  assert.equal(denied.reason, DENY_REASONS.UNKNOWN_STRATEGY);
  const allowed = out.intents.find((i) => i.strategyId === "S1_moonwell_base");
  assert.equal(allowed.decision, "allow");
});

test("autoExecute=false or newEntriesAllowed=false denies that strategy", () => {
  const out = dispatchStrategyCatalog({
    candidates: [candidateA, { ...candidateA, strategyId: "S2" }],
    adaptiveCapitalPlan: plan({
      strategies: [
        { strategyId: "S1_moonwell_base", autoExecute: false },
        { strategyId: "S2", newEntriesAllowed: false },
      ],
    }),
    feedFreshness: freshFeeds,
    btcPriceUsd: BTC_PRICE,
  });
  const a = out.intents.find((i) => i.strategyId === "S1_moonwell_base");
  const b = out.intents.find((i) => i.strategyId === "S2");
  assert.equal(a.reason, DENY_REASONS.AUTO_EXECUTE_OFF);
  assert.equal(b.reason, DENY_REASONS.NEW_ENTRIES_BLOCKED);
});

test("negative post-cost edge denied", () => {
  const bad = {
    ...candidateA,
    expectedYieldSats: 5_000,
    roundTripCostSats: 10_000,
  };
  const out = dispatchStrategyCatalog({
    candidates: [bad],
    adaptiveCapitalPlan: plan({ strategies: [{ strategyId: "S1_moonwell_base" }] }),
    feedFreshness: freshFeeds,
    btcPriceUsd: BTC_PRICE,
  });
  assert.equal(out.intents[0].reason, DENY_REASONS.NEGATIVE_EDGE);
});

test("cap shrinks allocation below request; binding=static", () => {
  // perTxUsd=$500 at $100k/BTC = 500/100000 BTC = 0.005 BTC = 500_000 sats
  const out = dispatchStrategyCatalog({
    candidates: [{ ...candidateA, proposedAllocationSats: 10_000_000 }],
    adaptiveCapitalPlan: plan({
      strategies: [
        { strategyId: "S1_moonwell_base", perTxUsd: 500, perDayUsd: 2000 },
      ],
    }),
    feedFreshness: freshFeeds,
    btcPriceUsd: BTC_PRICE,
  });
  const intent = out.intents[0];
  assert.equal(intent.decision, "allow");
  assert.equal(intent.allowedAllocationSats, 500_000);
  assert.equal(intent.detail.bindingConstraint, "static");
});

test("cap zero denied", () => {
  const out = dispatchStrategyCatalog({
    candidates: [candidateA],
    adaptiveCapitalPlan: plan({
      strategies: [
        { strategyId: "S1_moonwell_base", perTxUsd: 0, perDayUsd: 0 },
      ],
    }),
    feedFreshness: freshFeeds,
    btcPriceUsd: BTC_PRICE,
  });
  assert.equal(out.intents[0].reason, DENY_REASONS.CAP_ZERO);
});

test("diversification violation shrinks allocation", () => {
  // Current per-chain base already at 30% of total. Adding more would push >35%.
  const absoluteAllocations = {
    perStrategy: { S1_moonwell_base: 30_000_000, other: 70_000_000 },
    perChain: { base: 30_000_000, bob: 70_000_000 },
    perProtocol: { moonwell: 30_000_000, other: 70_000_000 },
  };
  const divSlice = {
    policy: {
      perStrategyMaxShare: 0.25,
      perChainMaxShare: 0.35,
      perProtocolMaxShare: 0.30,
      hhiMax: 0.30,
    },
  };
  const out = dispatchStrategyCatalog({
    candidates: [{ ...candidateA, proposedAllocationSats: 50_000_000 }],
    adaptiveCapitalPlan: plan({
      strategies: [
        { strategyId: "S1_moonwell_base", perTxUsd: 1_000_000, perDayUsd: 1_000_000 },
      ],
    }),
    diversificationSlice: divSlice,
    absoluteAllocations,
    feedFreshness: freshFeeds,
    btcPriceUsd: BTC_PRICE,
  });
  const i = out.intents[0];
  // Allocation should be capped by strategy share (25%) binding first:
  // per-strategy current 30M/100M = 30%, already over 25% — so any add
  // increases share; shrinker converges to 0 and denies.
  assert.equal(i.decision, "deny");
  assert.equal(i.reason, DENY_REASONS.DIVERSIFICATION_VIOLATED);
  assert.equal(i.detail.dimension, "strategy");
});

test("diversification shrink keeps allow when slack exists", () => {
  // S1 is currently at 10% and perStrategyMax=25%; 100M total.
  // Capping at 15% more would be 15M, ending at 25%. Binding="diversification".
  const absoluteAllocations = {
    perStrategy: { S1_moonwell_base: 10_000_000, other: 90_000_000 },
    perChain: { base: 10_000_000, bob: 90_000_000 },
    perProtocol: { moonwell: 10_000_000, other: 90_000_000 },
  };
  const divSlice = {
    policy: {
      perStrategyMaxShare: 0.25,
      perChainMaxShare: 0.35,
      perProtocolMaxShare: 0.30,
      hhiMax: 0.30,
    },
  };
  const out = dispatchStrategyCatalog({
    candidates: [{ ...candidateA, proposedAllocationSats: 50_000_000 }],
    adaptiveCapitalPlan: plan({
      strategies: [
        { strategyId: "S1_moonwell_base", perTxUsd: 1_000_000, perDayUsd: 1_000_000 },
      ],
    }),
    diversificationSlice: divSlice,
    absoluteAllocations,
    feedFreshness: freshFeeds,
    btcPriceUsd: BTC_PRICE,
  });
  const i = out.intents[0];
  assert.equal(i.decision, "allow");
  // must be strictly less than 50M, >0, and not push any share over its max.
  assert.ok(i.allowedAllocationSats > 0);
  assert.ok(i.allowedAllocationSats < 50_000_000);
  assert.equal(i.detail.bindingConstraint, "diversification");
});

test("ranked allow-first by net sats desc", () => {
  const c1 = { ...candidateA, strategyId: "A", expectedYieldSats: 20_000 };
  const c2 = { ...candidateA, strategyId: "B", expectedYieldSats: 100_000 };
  const c3 = { ...candidateA, strategyId: "C", expectedYieldSats: 5_000 }; // negative edge
  const out = dispatchStrategyCatalog({
    candidates: [c1, c2, c3],
    adaptiveCapitalPlan: plan({
      strategies: [
        { strategyId: "A" },
        { strategyId: "B" },
        { strategyId: "C" },
      ],
    }),
    feedFreshness: freshFeeds,
    btcPriceUsd: BTC_PRICE,
  });
  const ids = out.intents.map((i) => i.strategyId);
  assert.deepEqual(ids, ["B", "A", "C"]); // allows first desc net, deny last
  assert.equal(out.intents[0].decision, "allow");
  assert.equal(out.intents[2].decision, "deny");
});

test("frozen output and summary correctness", () => {
  const out = dispatchStrategyCatalog({
    candidates: [candidateA],
    adaptiveCapitalPlan: plan({
      strategies: [
        { strategyId: "S1_moonwell_base", perTxUsd: 1000, perDayUsd: 5000 },
      ],
    }),
    feedFreshness: freshFeeds,
    btcPriceUsd: BTC_PRICE,
  });
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.summary));
  assert.ok(Object.isFrozen(out.intents[0]));
  assert.equal(out.summary.totalCandidates, 1);
  assert.equal(out.summary.allowCount, 1);
  assert.equal(out.summary.denyCount, 0);
  assert.equal(out.summary.totalAllowedSats, out.intents[0].allowedAllocationSats);
  assert.equal(out.summary.totalExpectedNetSats, 40_000); // 50k - 10k
});

test("deterministic output for same input", () => {
  const args = () => ({
    candidates: [candidateA, { ...candidateA, strategyId: "S2" }],
    adaptiveCapitalPlan: plan({
      strategies: [{ strategyId: "S1_moonwell_base" }, { strategyId: "S2" }],
    }),
    feedFreshness: freshFeeds,
    btcPriceUsd: BTC_PRICE,
    now: "2026-04-21T00:00:00.000Z",
  });
  const a = dispatchStrategyCatalog(args());
  const b = dispatchStrategyCatalog(args());
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});
