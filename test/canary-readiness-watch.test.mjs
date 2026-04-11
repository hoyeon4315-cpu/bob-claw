import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNextReadinessCheckArgs,
  decisionFingerprint,
  formatCanaryTelegramAlert,
  formatCanaryWatchSummary,
  planNextReadinessRefresh,
  planBlockedScoreRefresh,
  shouldRefreshGasForCanary,
} from "../src/watch/canary-readiness-watch.mjs";

test("canary readiness summary includes decision and route", () => {
  const summary = formatCanaryWatchSummary({
    decision: "FUND_AND_APPROVE_WALLET",
    headline: "Fund and approve the estimator wallet before exact gas",
    route: { label: "bob->base wBTC.OFT->wBTC.OFT", amount: "10000" },
    reasons: ["native", "token", "allowance"],
  });

  assert.match(summary, /decision=FUND_AND_APPROVE_WALLET/);
  assert.match(summary, /route=bob->base wBTC.OFT->wBTC.OFT amount=10000/);
  assert.match(summary, /reasons=native,token,allowance/);
});

test("telegram alert formats canary decision updates", () => {
  const text = formatCanaryTelegramAlert({
    decision: "RUN_EXACT_GAS",
    headline: "Run exact gas estimate for the best prepared route",
    route: { label: "bob->base wBTC.OFT->wBTC.OFT", amount: "10000" },
    reasons: ["exact_src_execution_gas_not_estimated"],
  });

  assert.match(text, /BOB Claw canary update/);
  assert.match(text, /decision: RUN_EXACT_GAS/);
  assert.match(text, /route: bob->base wBTC.OFT->wBTC.OFT/);
});

test("decision fingerprint changes when route or reasons change", () => {
  const a = decisionFingerprint({
    decision: "FUND_AND_APPROVE_WALLET",
    route: { routeKey: "bob:token->base:token", amount: "10000" },
    reasons: ["native"],
  });
  const b = decisionFingerprint({
    decision: "FUND_AND_APPROVE_WALLET",
    route: { routeKey: "bob:token->base:token", amount: "10000" },
    reasons: ["native", "token"],
  });

  assert.notEqual(a, b);
});

test("next readiness check args target only the selected route and amount", () => {
  assert.deepEqual(
    buildNextReadinessCheckArgs(
      {
        canary: {
          nextReadinessCheck: {
            routeKey: "base:0x0555->bob:0x0555",
            amount: "10000",
          },
        },
      },
      "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    ),
    [
      "--route-key=base:0x0555->bob:0x0555",
      "--amount=10000",
      "--address=0x96262be63aa687563789225c2fe898c27a3b0ae4",
    ],
  );
  assert.equal(buildNextReadinessCheckArgs({ canary: {} }), null);
});

test("next readiness refresh is skipped when a matching recent record is still fresh", () => {
  const plan = planNextReadinessRefresh(
    {
      shadowCycle: {
        canary: {
          nextReadinessCheck: {
            routeKey: "base:0x0555->bob:0x0555",
            amount: "10000",
          },
        },
      },
      readinessRecords: [
        {
          observedAt: "2026-04-11T06:04:00.000Z",
          address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
          routeKey: "base:0x0555->bob:0x0555",
          amount: "10000",
        },
      ],
      readinessFailures: [],
      address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    },
    {
      now: "2026-04-11T06:05:00.000Z",
      maxAgeMs: 300_000,
    },
  );

  assert.equal(plan.shouldRefresh, false);
  assert.equal(plan.reason, "fresh_recent_check");
  assert.equal(plan.latestObservedAt, "2026-04-11T06:04:00.000Z");
});

test("next readiness refresh runs again when the last matching observation is stale", () => {
  const plan = planNextReadinessRefresh(
    {
      shadowCycle: {
        canary: {
          nextReadinessCheck: {
            routeKey: "base:0x0555->bob:0x0555",
            amount: "10000",
          },
        },
      },
      readinessRecords: [],
      readinessFailures: [
        {
          observedAt: "2026-04-11T05:50:00.000Z",
          address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
          routeKey: "base:0x0555->bob:0x0555",
          amount: "10000",
        },
      ],
      address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    },
    {
      now: "2026-04-11T06:05:00.000Z",
      maxAgeMs: 300_000,
    },
  );

  assert.equal(plan.shouldRefresh, true);
  assert.equal(plan.reason, "stale_check");
  assert.equal(plan.latestObservedAt, "2026-04-11T05:50:00.000Z");
});

test("stale gas only blocker triggers gas refresh loop", () => {
  assert.equal(
    shouldRefreshGasForCanary({
      decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      reasons: ["stale_src_gas_snapshot"],
    }),
    true,
  );
  assert.equal(
    shouldRefreshGasForCanary({
      decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      reasons: ["stale_src_gas_snapshot", "missing_src_token_price"],
    }),
    false,
  );
});

test("blocked net-edge route refreshes scoring when a newer route input exists", () => {
  const plan = planBlockedScoreRefresh({
    nextStep: {
      decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      route: {
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        srcChain: "bob",
        dstChain: "base",
      },
      reasons: ["reject_no_net_edge"],
    },
    scoreSnapshot: {
      generatedAt: "2026-04-11T06:00:00.000Z",
    },
    quotes: [
      {
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        observedAt: "2026-04-11T06:04:00.000Z",
      },
    ],
    gasEstimateSnapshots: [],
    dexQuotes: [],
    gasSnapshots: [
      {
        chain: "bob",
        observedAt: "2026-04-11T05:55:00.000Z",
      },
    ],
    bitcoinFeeSnapshots: [],
  });

  assert.equal(plan.shouldRefresh, true);
  assert.equal(plan.reason, "newer_market_inputs");
  assert.deepEqual(plan.changedInputs, ["quote"]);
  assert.equal(plan.latestObservedAt, "2026-04-11T06:04:00.000Z");
});

test("blocked net-edge route skips rescoring when score inputs are unchanged", () => {
  const plan = planBlockedScoreRefresh({
    nextStep: {
      decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      route: {
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        srcChain: "bob",
        dstChain: "base",
      },
      reasons: ["reject_no_net_edge"],
    },
    scoreSnapshot: {
      generatedAt: "2026-04-11T06:00:00.000Z",
    },
    quotes: [
      {
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        observedAt: "2026-04-11T05:59:00.000Z",
      },
    ],
    gasEstimateSnapshots: [
      {
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        observedAt: "2026-04-11T05:58:00.000Z",
      },
    ],
    dexQuotes: [],
    gasSnapshots: [
      {
        chain: "bob",
        observedAt: "2026-04-11T05:57:00.000Z",
      },
    ],
    bitcoinFeeSnapshots: [],
  });

  assert.equal(plan.shouldRefresh, false);
  assert.equal(plan.reason, "score_inputs_unchanged");
  assert.deepEqual(plan.changedInputs, []);
  assert.equal(plan.latestObservedAt, "2026-04-11T05:59:00.000Z");
});

test("blocked net-edge route refreshes scoring when a newer price snapshot changes the route price", () => {
  const plan = planBlockedScoreRefresh({
    nextStep: {
      decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      route: {
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        srcChain: "bob",
        dstChain: "base",
        srcToken: "0x0555",
        dstToken: "0x0555",
      },
      reasons: ["reject_no_net_edge"],
    },
    scoreSnapshot: {
      generatedAt: "2026-04-11T06:00:00.000Z",
      scores: [
        {
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
          price: {
            srcRawUsd: 50_000,
            dstRawUsd: 50_000,
          },
        },
      ],
    },
    priceSnapshots: [
      {
        observedAt: "2026-04-11T06:04:00.000Z",
        btcUsd: 50_500,
        tokenByKey: {
          btc: 50_500,
          wbtc: 50_500,
        },
        nativeByChain: {
          bob: 3000,
          base: 3000,
        },
      },
    ],
    quotes: [],
    gasEstimateSnapshots: [],
    dexQuotes: [],
    gasSnapshots: [],
    bitcoinFeeSnapshots: [],
  });

  assert.equal(plan.shouldRefresh, true);
  assert.equal(plan.reason, "newer_market_inputs");
  assert.deepEqual(plan.changedInputs, ["src_price", "dst_price"]);
  assert.equal(plan.latestObservedAt, "2026-04-11T06:04:00.000Z");
});
