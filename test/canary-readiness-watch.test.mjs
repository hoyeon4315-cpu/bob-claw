import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCanaryInputRefreshDexArgs,
  buildCanaryInputRefreshExactGasArgs,
  buildCanaryInputRefreshGasSnapshotArgs,
  buildCanaryInputRefreshScoringArgs,
  buildCanaryInputRefreshVerifyArgs,
  buildBlockedScoreRefreshScoringArgs,
  buildDexGatewayCoverageDexQuoteArgs,
  buildDexGatewayCoverageScoringArgs,
  buildDexGatewayCoverageVerifyArgs,
  buildDexEnvironmentRefreshQuoteArgs,
  buildQuoteDecayRefreshScoringArgs,
  describeBlockedScoreRefreshSelection,
  buildGasRefreshScoringArgs,
  buildGasRefreshSnapshotArgs,
  buildDexRefreshScoringArgs,
  buildNextReadinessCheckArgs,
  decisionFingerprint,
  formatCanaryTelegramAlert,
  formatCanaryWatchSummary,
  planCanaryInputRefresh,
  planDexPriceRefresh,
  planGasRefresh,
  planNextReadinessRefresh,
  planBlockedScoreRefresh,
  planDexEnvironmentRefresh,
  planDexGatewayCoverageRefresh,
  planQuoteDecayRefresh,
  summarizeShadowArtifactRefresh,
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

test("shadow artifact refresh summary keeps watcher logs concise", () => {
  const summary = summarizeShadowArtifactRefresh({
    priceOutput: "skipped=recently_unchanged\nobservedAt=2026-04-11T07:00:00.000Z\nbtcUsd=80000\n",
    shadowOutput: "unchanged=data/shadow-cycle-latest.json\n",
    dashboardOutput: [
      "unchanged=data/dashboard-status.json",
      "dashboardUnchanged=dashboard/public/dashboard-status.json",
      "severity=warn",
    ].join("\n"),
  });

  assert.equal(summary, "refresh=shadow-artifacts price=skip:recently_unchanged shadow=skip dashboard=skip/skip");
});

test("shadow artifact refresh summary distinguishes skipped price snapshots from failures", () => {
  const summary = summarizeShadowArtifactRefresh({
    priceOutput: "skipped=not_requested\n",
    shadowOutput: "wrote=data/shadow-cycle-latest.json\n",
    dashboardOutput: [
      "unchanged=data/dashboard-status.json",
      "dashboardWrote=dashboard/public/dashboard-status.json",
    ].join("\n"),
  });

  assert.equal(summary, "refresh=shadow-artifacts price=skip:not_requested shadow=refresh dashboard=skip/refresh");
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

test("gas refresh plan targets the source chain and exact route", () => {
  const plan = planGasRefresh({
    nextStep: {
      decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      route: {
        routeKey: "base:0x0555->bob:0x0555",
        amount: "10000",
        srcChain: "base",
      },
      reasons: ["stale_src_gas_snapshot"],
    },
  });

  assert.equal(plan.shouldRefresh, true);
  assert.equal(plan.reason, "stale_src_gas_snapshot");
  assert.deepEqual(plan.chains, ["base"]);
  assert.deepEqual(buildGasRefreshSnapshotArgs(plan), ["--chains=base"]);
  assert.deepEqual(buildGasRefreshScoringArgs(plan), ["--write", "--route-key=base:0x0555->bob:0x0555", "--amount=10000"]);
});

test("gas refresh plan skips when the stale gas blocker is mixed with other reasons", () => {
  const plan = planGasRefresh({
    nextStep: {
      decision: "BLOCKED_NO_VIABLE_PREP_ROUTE",
      route: {
        routeKey: "base:0x0555->bob:0x0555",
        amount: "10000",
        srcChain: "base",
      },
      reasons: ["stale_src_gas_snapshot", "missing_src_token_price"],
    },
  });

  assert.equal(plan.shouldRefresh, false);
  assert.equal(plan.reason, "not_stale_src_gas_blocked");
});

test("canary input refresh targets stale current route inputs with selective commands", () => {
  const plan = planCanaryInputRefresh({
    nextStep: {
      route: {
        label: "bob->base wBTC.OFT->wBTC.OFT",
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        srcChain: "bob",
        dstChain: "base",
      },
    },
    dashboardStatus: {
      canaryInputs: {
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        gatewayQuote: { state: "stale" },
        exactGas: { state: "stale" },
        srcGas: { state: "stale" },
        dexQuote: { state: "stale" },
        bitcoinFee: { state: "not_needed" },
        marketSnapshot: { state: "fresh" },
      },
    },
  });

  assert.equal(plan.shouldRefresh, true);
  assert.equal(plan.reason, "stale_canary_route_inputs");
  assert.deepEqual(plan.inputKeys, ["gateway_quote", "exact_gas", "src_gas", "dex_quote"]);
  assert.deepEqual(buildCanaryInputRefreshVerifyArgs(plan), [
    "--route-key=bob:0x0555->base:0x0555",
    "--amounts=10000",
  ]);
  assert.deepEqual(buildCanaryInputRefreshExactGasArgs(plan, "0xabc"), [
    "--from=0xabc",
    "--route-key=bob:0x0555->base:0x0555",
    "--amount=10000",
  ]);
  assert.deepEqual(buildCanaryInputRefreshGasSnapshotArgs(plan), ["--chains=bob"]);
  assert.deepEqual(buildCanaryInputRefreshDexArgs(plan), [
    "--route-key=bob:0x0555->base:0x0555",
    "--amount=10000",
  ]);
  assert.deepEqual(buildCanaryInputRefreshScoringArgs(plan), [
    "--write",
    "--route-key=bob:0x0555->base:0x0555",
    "--amount=10000",
  ]);
});

test("canary input refresh reports fresh route inputs without forcing commands", () => {
  const plan = planCanaryInputRefresh({
    nextStep: {
      route: {
        label: "bob->base wBTC.OFT->wBTC.OFT",
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        srcChain: "bob",
        dstChain: "base",
      },
    },
    dashboardStatus: {
      canaryInputs: {
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        gatewayQuote: { state: "fresh" },
        exactGas: { state: "fresh" },
        srcGas: { state: "fresh" },
        dexQuote: { state: "fresh" },
        bitcoinFee: { state: "not_needed" },
        marketSnapshot: { state: "fresh" },
      },
    },
  });

  assert.equal(plan.shouldRefresh, false);
  assert.equal(plan.reason, "canary_route_inputs_fresh");
  assert.deepEqual(plan.inputKeys, []);
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

test("blocked score refresh broadens rescoring to touched chains when shared price inputs changed", () => {
  assert.deepEqual(
    buildBlockedScoreRefreshScoringArgs(
      {
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        changedInputs: ["src_price", "dst_price"],
      },
      {
        srcChain: "bob",
        dstChain: "base",
      },
    ),
    ["--write", "--touch-chains=bob,base"],
  );
  assert.deepEqual(
    describeBlockedScoreRefreshSelection(
      {
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        changedInputs: ["src_price", "dst_price"],
      },
      {
        srcChain: "bob",
        dstChain: "base",
      },
    ),
    {
      scope: "touch_chains",
      chains: ["bob", "base"],
    },
  );
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

test("quote decay refresh triggers when the next target window is due", () => {
  const plan = planQuoteDecayRefresh(
    {
      nextStep: {
        route: {
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
        },
      },
      shadowObservations: [
        {
          observedAt: "2026-04-11T06:00:00.000Z",
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
        },
        {
          observedAt: "2026-04-11T06:00:08.000Z",
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
        },
      ],
    },
    {
      now: "2026-04-11T06:00:16.000Z",
      windowsSeconds: [5, 15, 30],
    },
  );

  assert.equal(plan.shouldRefresh, true);
  assert.equal(plan.reason, "due_decay_window");
  assert.equal(plan.pendingWindowSeconds, 15);
  assert.equal(plan.anchorObservedAt, "2026-04-11T06:00:00.000Z");
});

test("quote decay refresh waits until the next target window arrives", () => {
  const plan = planQuoteDecayRefresh(
    {
      nextStep: {
        route: {
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
        },
      },
      shadowObservations: [
        {
          observedAt: "2026-04-11T06:00:00.000Z",
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
        },
        {
          observedAt: "2026-04-11T06:00:08.000Z",
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
        },
      ],
    },
    {
      now: "2026-04-11T06:00:11.000Z",
      windowsSeconds: [5, 15, 30],
    },
  );

  assert.equal(plan.shouldRefresh, false);
  assert.equal(plan.reason, "waiting_decay_window");
  assert.equal(plan.pendingWindowSeconds, 15);
});

test("quote decay refresh seeds an initial observation when none exist for the route", () => {
  const plan = planQuoteDecayRefresh(
    {
      nextStep: {
        route: {
          routeKey: "bob:0x0555->base:0x0555",
          amount: "10000",
        },
      },
      shadowObservations: [],
    },
    {
      now: "2026-04-11T06:00:11.000Z",
      windowsSeconds: [5, 15, 30],
    },
  );

  assert.equal(plan.shouldRefresh, true);
  assert.equal(plan.reason, "missing_decay_observation");
});

test("quote decay scoring args stay selective only when route and amount are present", () => {
  assert.deepEqual(
    buildQuoteDecayRefreshScoringArgs({
      routeKey: "bob:0x0555->base:0x0555",
      amount: "10000",
    }),
    ["--write", "--route-key=bob:0x0555->base:0x0555", "--amount=10000", "--shadow-rollover-ms=0"],
  );
  assert.deepEqual(
    buildQuoteDecayRefreshScoringArgs({
      routeKey: null,
      amount: "10000",
    }),
    ["--write", "--shadow-rollover-ms=0"],
  );
});

test("dex price refresh targets missing supported route chains", () => {
  const plan = planDexPriceRefresh({
    nextStep: {
      route: {
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        srcChain: "bob",
        dstChain: "base",
      },
    },
    dashboardStatus: {
      market: {
        chainWbtcPrices: [
          { chain: "base", usd: null, stale: false },
          { chain: "bob", usd: null, stale: false },
        ],
      },
    },
  });

  assert.equal(plan.shouldRefresh, true);
  assert.equal(plan.reason, "missing_chain_price");
  assert.deepEqual(plan.chains, ["base"]);
});

test("dex price refresh skips when supported route chains are fresh", () => {
  const plan = planDexPriceRefresh({
    nextStep: {
      route: {
        routeKey: "ethereum:0x2260->base:0x0555",
        amount: "10000",
        srcChain: "ethereum",
        dstChain: "base",
      },
    },
    dashboardStatus: {
      market: {
        chainWbtcPrices: [
          { chain: "ethereum", usd: 72_740, stale: false },
          { chain: "base", usd: 72_763, stale: false },
        ],
      },
    },
  });

  assert.equal(plan.shouldRefresh, false);
  assert.equal(plan.reason, "chain_prices_fresh");
  assert.deepEqual(plan.chains, ["ethereum", "base"]);
});

test("dex price refresh retriggers on stale supported chain prices", () => {
  const plan = planDexPriceRefresh({
    nextStep: {
      route: {
        routeKey: "ethereum:0x2260->base:0x0555",
        amount: "10000",
        srcChain: "ethereum",
        dstChain: "base",
      },
    },
    dashboardStatus: {
      market: {
        chainWbtcPrices: [
          { chain: "ethereum", usd: 72_740, stale: true },
          { chain: "base", usd: 72_763, stale: false },
        ],
      },
    },
  });

  assert.equal(plan.shouldRefresh, true);
  assert.equal(plan.reason, "stale_chain_price");
  assert.deepEqual(plan.chains, ["ethereum"]);
});

test("dex price refresh falls back to other quoteable gateway chains when route chains are fresh", () => {
  const plan = planDexPriceRefresh({
    nextStep: {
      route: {
        routeKey: "ethereum:0x2260->base:0x0555",
        amount: "10000",
        srcChain: "ethereum",
        dstChain: "base",
      },
    },
    dashboardStatus: {
      market: {
        chainWbtcPrices: [
          { chain: "ethereum", usd: 72_740, stale: false, quoteable: true },
          { chain: "base", usd: 72_763, stale: false, quoteable: true },
          { chain: "avalanche", usd: null, stale: false, quoteable: true },
          { chain: "sonic", usd: null, stale: false, quoteable: true },
          { chain: "bob", usd: null, stale: false, quoteable: false },
        ],
      },
    },
  });

  assert.equal(plan.shouldRefresh, true);
  assert.equal(plan.reason, "missing_gateway_chain_price");
  assert.equal(plan.routeKey, null);
  assert.equal(plan.amount, null);
  assert.deepEqual(plan.chains, ["avalanche", "sonic"]);
});

test("dex price refresh falls back to stale quoteable gateway chains when none are missing", () => {
  const plan = planDexPriceRefresh({
    nextStep: {
      route: {
        routeKey: "ethereum:0x2260->base:0x0555",
        amount: "10000",
        srcChain: "ethereum",
        dstChain: "base",
      },
    },
    dashboardStatus: {
      market: {
        chainWbtcPrices: [
          { chain: "ethereum", usd: 72_740, stale: false, quoteable: true },
          { chain: "base", usd: 72_763, stale: false, quoteable: true },
          { chain: "avalanche", usd: 72_800, stale: true, quoteable: true },
          { chain: "sonic", usd: 72_810, stale: true, quoteable: true },
        ],
      },
    },
  });

  assert.equal(plan.shouldRefresh, true);
  assert.equal(plan.reason, "stale_gateway_chain_price");
  assert.equal(plan.routeKey, null);
  assert.equal(plan.amount, null);
  assert.deepEqual(plan.chains, ["avalanche", "sonic"]);
});

test("dex refresh scoring args target one exact route when route selection is present", () => {
  assert.deepEqual(
    buildDexRefreshScoringArgs({
      routeKey: "bob:0x0555->base:0x0555",
      amount: "10000",
      chains: ["base"],
    }),
    [
      "--write",
      "--route-key=bob:0x0555->base:0x0555",
      "--amount=10000",
    ],
  );
});

test("dex refresh scoring args target destination chains when refresh is global", () => {
  assert.deepEqual(
    buildDexRefreshScoringArgs({
      routeKey: null,
      amount: null,
      chains: ["avalanche", "sonic"],
    }),
    [
      "--write",
      "--dst-chains=avalanche,sonic",
    ],
  );
});

test("dex refresh scoring args fall back to full write when no chain list exists", () => {
  assert.deepEqual(buildDexRefreshScoringArgs({ routeKey: null, amount: null, chains: [] }), ["--write"]);
});

test("dex environment refresh targets the riskiest stale route with stable-entry quotes enabled", () => {
  const plan = planDexEnvironmentRefresh({
    dashboardStatus: {
      strategy: {
        dexEnvironment: {
          monitoredRouteCount: 2,
          staleLegCount: 1,
          unstableLegCount: 0,
          thinLiquidityLegCount: 1,
          singleSampleLegCount: 0,
          topRiskRoute: {
            routeKey: "base:0x0555->bitcoin:0x0000",
            amount: "10000",
            classification: "refresh_needed",
          },
          routes: [
            {
              routeKey: "base:0x0555->bitcoin:0x0000",
              amount: "10000",
              classification: "refresh_needed",
            },
            {
              routeKey: "ethereum:0x2260->bitcoin:0x0000",
              amount: "10000",
              classification: "thin_liquidity",
            },
          ],
        },
      },
    },
  });

  assert.equal(plan.shouldRefresh, true);
  assert.equal(plan.reason, "stale_dex_environment");
  assert.equal(plan.routeKey, "base:0x0555->bitcoin:0x0000");
  assert.equal(plan.targetRouteCount, 2);
  assert.deepEqual(buildDexEnvironmentRefreshQuoteArgs(plan), [
    "--include-stable-entry",
    "--route-key=base:0x0555->bitcoin:0x0000",
    "--amount=10000",
  ]);
});

test("dex environment refresh reports stable environments without forcing a route refresh", () => {
  const plan = planDexEnvironmentRefresh({
    dashboardStatus: {
      strategy: {
        dexEnvironment: {
          monitoredRouteCount: 1,
          staleLegCount: 0,
          unstableLegCount: 0,
          thinLiquidityLegCount: 0,
          singleSampleLegCount: 0,
          topRiskRoute: {
            routeKey: "base:0x0555->bitcoin:0x0000",
            amount: "10000",
            classification: "stable_enough_to_monitor",
          },
          routes: [
            {
              routeKey: "base:0x0555->bitcoin:0x0000",
              amount: "10000",
              classification: "stable_enough_to_monitor",
            },
          ],
        },
      },
    },
  });

  assert.equal(plan.shouldRefresh, false);
  assert.equal(plan.reason, "dex_environment_stable");
  assert.deepEqual(buildDexEnvironmentRefreshQuoteArgs(plan), ["--include-stable-entry", "--route-key=base:0x0555->bitcoin:0x0000", "--amount=10000"]);
});

test("gateway coverage refresh targets fully measurable routes that still lack Gateway quotes", () => {
  const plan = planDexGatewayCoverageRefresh({
    dashboardStatus: {
      strategy: {
        dexRouteFocus: {
          fullyMeasurableRouteCount: 3,
          missingGatewayQuoteCount: 2,
          routes: [
            {
              routeKey: "base:0x0555->avalanche:0x0555",
              srcChain: "base",
              dstChain: "avalanche",
              classification: "missing_gateway_quote",
            },
            {
              routeKey: "ethereum:0x2260->base:0x0555",
              srcChain: "ethereum",
              dstChain: "base",
              classification: "missing_gateway_quote",
            },
            {
              routeKey: "base:0x0555->bsc:0x0555",
              srcChain: "base",
              dstChain: "bsc",
              classification: "partial_loop_measurement",
            },
          ],
        },
      },
    },
  });

  assert.equal(plan.shouldRefresh, true);
  assert.equal(plan.reason, "missing_gateway_focus_quotes");
  assert.equal(plan.targetRouteCount, 2);
  assert.deepEqual(plan.touchChains, ["base", "avalanche", "ethereum"]);
  assert.deepEqual(buildDexGatewayCoverageVerifyArgs(plan.targetRoutes[0], plan), [
    "--route-key=base:0x0555->avalanche:0x0555",
    "--amounts=10000,25000,50000,100000,150000",
  ]);
  assert.deepEqual(buildDexGatewayCoverageDexQuoteArgs(plan.targetRoutes[0]), [
    "--include-stable-entry",
    "--route-key=base:0x0555->avalanche:0x0555",
  ]);
  assert.deepEqual(buildDexGatewayCoverageScoringArgs(plan), [
    "--write",
    "--touch-chains=base,avalanche,ethereum",
  ]);
});

test("gateway coverage refresh reports when the focus shortlist is already covered", () => {
  const plan = planDexGatewayCoverageRefresh({
    dashboardStatus: {
      strategy: {
        dexRouteFocus: {
          fullyMeasurableRouteCount: 2,
          missingGatewayQuoteCount: 0,
          routes: [
            {
              routeKey: "base:0x0555->avalanche:0x0555",
              srcChain: "base",
              dstChain: "avalanche",
              classification: "loop_observable",
            },
          ],
        },
      },
    },
  });

  assert.equal(plan.shouldRefresh, false);
  assert.equal(plan.reason, "gateway_focus_covered");
});
