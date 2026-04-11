import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOverfitAudit } from "../src/audit/overfit.mjs";

const BTC = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

function makeRoutes(count = 20) {
  const routes = [];
  const chains = ["base", "sonic", "bsc", "avalanche", "soneium", "unichain", "bera", "ethereum", "bitcoin"];
  for (const chain of chains) {
    routes.push({ srcChain: "bob", dstChain: chain, srcToken: BTC, dstToken: chain === "bitcoin" ? "0x0000000000000000000000000000000000000000" : BTC });
    routes.push({ srcChain: chain, dstChain: "bob", srcToken: chain === "bitcoin" ? "0x0000000000000000000000000000000000000000" : BTC, dstToken: BTC });
  }
  while (routes.length < count) {
    routes.push({ srcChain: `chain${routes.length}`, dstChain: "base", srcToken: BTC, dstToken: BTC });
  }
  return routes;
}

function makeRouteKey(route) {
  return `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`;
}

function makeQuote(route, observedAt, amount = "10000") {
  return {
    schemaVersion: 2,
    observedAt,
    route,
    routeKey: makeRouteKey(route),
    quoteType: route.srcChain === "bitcoin" ? "onramp" : route.dstChain === "bitcoin" ? "offramp" : "layerZero",
    amount,
    grossOutputRatio: 1,
  };
}

test("audit blocks live trading for shallow, short-lived data", () => {
  const routes = makeRoutes(30);
  const quote = makeQuote(routes[0], "2026-04-10T00:00:00.000Z");
  const audit = buildOverfitAudit({
    now: "2026-04-10T00:10:00.000Z",
    routesRecords: [{ observedAt: "2026-04-10T00:00:00.000Z", routes, summary: { totalRoutes: routes.length } }],
    quotes: [quote],
    failures: [],
    gasSnapshots: [{ observedAt: "2026-04-10T00:09:00.000Z", chain: "bob" }],
    gasFailures: [],
  });

  assert.equal(audit.decision, "LIVE_BLOCKED");
  assert.equal(audit.shadow, "ALLOWED");
  assert.equal(audit.checks.find((check) => check.label === "shadow time window").ok, false);
});

test("audit allows canary review for broad, deep, fresh shadow data", () => {
  const routes = makeRoutes(22);
  const bobRoutes = routes.filter((route) => route.srcChain === "bob" || route.dstChain === "bob");
  const amounts = ["10000", "25000", "100000", "200000"];
  const quotes = [];

  for (let routeIndex = 0; routeIndex < bobRoutes.length; routeIndex += 1) {
    const route = bobRoutes[routeIndex];
    for (let sample = 0; sample < 32; sample += 1) {
      const hour = sample * 6;
      const observedAt = new Date(Date.UTC(2026, 3, 1, hour, routeIndex % 60, 0)).toISOString();
      quotes.push(makeQuote(route, observedAt, amounts[sample % amounts.length]));
    }
  }

  const audit = buildOverfitAudit({
    now: "2026-04-09T23:59:00.000Z",
    routesRecords: [{ observedAt: "2026-04-01T00:00:00.000Z", routes, summary: { totalRoutes: routes.length } }],
    quotes,
    failures: [],
    gasSnapshots: [{ observedAt: "2026-04-09T23:45:00.000Z", chain: "bob" }],
    gasFailures: [],
  });

  assert.equal(audit.decision, "LIVE_CANARY_REVIEW_POSSIBLE");
  assert.equal(audit.checks.every((check) => check.ok), true);
});

test("audit prefers shadow observations for depth and amount diversity gates", () => {
  const routes = makeRoutes(1);
  const route = routes[0];
  const audit = buildOverfitAudit(
    {
      now: "2026-04-10T03:00:00.000Z",
      routesRecords: [{ observedAt: "2026-04-10T00:00:00.000Z", routes, summary: { totalRoutes: routes.length } }],
      quotes: [makeQuote(route, "2026-04-10T00:00:00.000Z", "10000")],
      shadowObservations: [
        {
          observedAt: "2026-04-10T00:00:00.000Z",
          routeKey: makeRouteKey(route),
          amount: "10000",
          latencyMs: 900,
          executionGasUsd: 0.03,
        },
        {
          observedAt: "2026-04-10T02:00:00.000Z",
          routeKey: makeRouteKey(route),
          amount: "25000",
          latencyMs: 1500,
          executionGasUsd: 0.05,
        },
      ],
      failures: [],
      gasSnapshots: [{ observedAt: "2026-04-10T02:45:00.000Z", chain: "bob" }],
      gasFailures: [],
    },
    {
      currentQuoteSchemaVersion: 2,
      minShadowHours: 1,
      minBobNeighborCoveragePct: 0,
      minGlobalRouteCoveragePctForDiscovery: 0,
      minSamplesPerCandidateRoute: 2,
      minAmountLevelsPerCandidateRoute: 2,
      minHourBuckets: 2,
      maxFailureRatePct: 10,
      maxGasSnapshotAgeMinutes: 30,
      requiredQuoteDecayWindowsSeconds: [],
    },
  );

  assert.equal(audit.decision, "LIVE_CANARY_REVIEW_POSSIBLE");
  assert.equal(audit.sampleSource, "shadow_observations");
  assert.equal(audit.shadowObservations, 2);
  assert.equal(audit.hourBuckets, 2);
  assert.equal(audit.latencyP95Ms, 1500);
  assert.equal(audit.executionGasP95Usd, 0.05);
  assert.equal(audit.quoteDecayCoveredGroups, 0);
  assert.deepEqual(audit.topSampledRoutes[0], {
    routeKey: makeRouteKey(route),
    samples: 2,
    amountLevels: 2,
  });
});

test("audit summarizes quote decay coverage and survival windows from shadow observations", () => {
  const routes = makeRoutes(1);
  const route = routes[0];
  const routeKey = makeRouteKey(route);
  const audit = buildOverfitAudit(
    {
      now: "2026-04-10T01:10:00.000Z",
      routesRecords: [{ observedAt: "2026-04-10T00:00:00.000Z", routes, summary: { totalRoutes: routes.length } }],
      quotes: [],
      shadowObservations: [
        {
          observedAt: "2026-04-10T00:00:00.000Z",
          routeKey,
          amount: "10000",
          observedEdgePct: 0.012,
          requiredEdgePct: 0.01,
        },
        {
          observedAt: "2026-04-10T00:00:08.000Z",
          routeKey,
          amount: "10000",
          observedEdgePct: 0.0115,
          requiredEdgePct: 0.01,
        },
        {
          observedAt: "2026-04-10T00:00:18.000Z",
          routeKey,
          amount: "10000",
          observedEdgePct: 0.0105,
          requiredEdgePct: 0.01,
        },
        {
          observedAt: "2026-04-10T00:00:38.000Z",
          routeKey,
          amount: "10000",
          observedEdgePct: 0.009,
          requiredEdgePct: 0.01,
        },
      ],
      failures: [],
      gasSnapshots: [{ observedAt: "2026-04-10T01:05:00.000Z", chain: "bob" }],
      gasFailures: [],
    },
    {
      minShadowHours: 0,
      minBobNeighborCoveragePct: 0,
      minGlobalRouteCoveragePctForDiscovery: 0,
      minSamplesPerCandidateRoute: 1,
      minAmountLevelsPerCandidateRoute: 1,
      minHourBuckets: 1,
      maxFailureRatePct: 10,
      maxGasSnapshotAgeMinutes: 30,
      requiredQuoteDecayWindowsSeconds: [5, 15, 30],
      minQuoteDecayCoveredGroupsPerWindow: 1,
    },
  );

  assert.equal(audit.decision, "LIVE_CANARY_REVIEW_POSSIBLE");
  assert.equal(audit.quoteDecayCoveredGroups, 1);
  assert.deepEqual(
    audit.quoteDecayWindows.map((item) => ({
      windowSeconds: item.windowSeconds,
      coveredGroups: item.coveredGroups,
      profitableStartGroups: item.profitableStartGroups,
      survivedGroups: item.survivedGroups,
    })),
    [
      { windowSeconds: 5, coveredGroups: 1, profitableStartGroups: 1, survivedGroups: 1 },
      { windowSeconds: 15, coveredGroups: 1, profitableStartGroups: 1, survivedGroups: 1 },
      { windowSeconds: 30, coveredGroups: 1, profitableStartGroups: 1, survivedGroups: 0 },
      { windowSeconds: 60, coveredGroups: 0, profitableStartGroups: 0, survivedGroups: 0 },
    ],
  );
  assert.equal(audit.checks.find((check) => check.label === "quote decay windows").ok, true);
  assert.equal(audit.warnings.find((warning) => warning.label === "quote decay survival").ok, true);
});
