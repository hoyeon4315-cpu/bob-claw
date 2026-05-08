import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveRefillPrerequisiteDiagnostic,
  resolveRefillPrerequisites,
} from "../src/executor/dispatcher/refill-prerequisite-resolver.mjs";

const NOW = "2026-05-09T00:00:00.000Z";

test("routing_exhausted produces alternative bridge candidates instead of blocking intent emit", () => {
  const diagnostic = resolveRefillPrerequisiteDiagnostic({
    routeId: "base-to-bob-eth",
    blockedReason: "routing_exhausted",
    source: "ledger",
    route: {
      srcChain: "base",
      dstChain: "bob",
      srcAsset: "ETH",
      dstAsset: "ETH",
    },
  }, { now: NOW });

  assert.equal(diagnostic.blocker, "routing_exhausted");
  assert.equal(diagnostic.source, "ledger");
  assert.ok(diagnostic.alternativeCandidates.length >= 4);
  assert.deepEqual(diagnostic.alternativeCandidates.map((item) => item.provider), [
    "LI.FI",
    "Across",
    "native_canonical",
    "Hop",
  ]);
  assert.equal(diagnostic.prerequisite.kind, "refill");
  assert.equal(diagnostic.prerequisite.status, "pending_prerequisite");
  assert.equal(diagnostic.prerequisite.jobs[0].kind, "alternative_route_probe");
});

test("insufficient_funds queues idle inventory consolidation as refill prerequisite", () => {
  const diagnostic = resolveRefillPrerequisiteDiagnostic({
    routeId: "soneium-native-gas",
    blockedReason: "insufficient_funds",
    source: "inventory",
    route: {
      dstChain: "soneium",
      dstAsset: "ETH",
      targetAmountDecimal: 0.0007,
    },
  }, { now: NOW });

  assert.equal(diagnostic.blocker, "insufficient_funds");
  assert.equal(diagnostic.source, "inventory");
  assert.equal(diagnostic.prerequisite.jobs[0].kind, "idle_inventory_consolidation");
  assert.equal(diagnostic.prerequisite.jobs[0].lifecycleStage, "idle_consolidation_planned");
  assert.equal(diagnostic.prerequisite.jobs[0].queue, "idle_inventory_dispatch");
});

test("budget blockers are split or deferred to the deterministic 24h reset", () => {
  const diagnostic = resolveRefillPrerequisiteDiagnostic({
    routeId: "bsc-usdt",
    blockedReason: "discretionary_budget_24h_category_exhausted",
    source: "budget",
    route: {
      dstChain: "bsc",
      dstAsset: "USDT",
      targetAmountDecimal: 3,
    },
  }, { now: NOW });

  assert.equal(diagnostic.blocker, "budget_exceeded");
  assert.equal(diagnostic.source, "budget");
  assert.equal(diagnostic.prerequisite.jobs[0].kind, "split_refill");
  assert.equal(diagnostic.prerequisite.jobs[1].kind, "wait_for_budget_reset");
  assert.equal(diagnostic.prerequisite.expectedReadyBy, "2026-05-10T00:00:00.000Z");
});

test("resolver summarizes per-route diagnostics and keeps every route actionable or explicitly blocked", () => {
  const report = resolveRefillPrerequisites({
    now: NOW,
    diagnostics: [
      {
        routeId: "route-1",
        blockedReason: "routing_exhausted",
        source: "ledger",
        route: { srcChain: "ethereum", dstChain: "base", srcAsset: "USDC", dstAsset: "USDC" },
      },
      {
        routeId: "route-2",
        blockedReason: "insufficient_funds",
        source: "inventory",
        route: { dstChain: "soneium", dstAsset: "ETH" },
      },
    ],
  });

  assert.equal(report.summary.prerequisiteCount, 2);
  assert.equal(report.summary.byBlocker.routing_exhausted, 1);
  assert.equal(report.summary.byBlocker.insufficient_funds, 1);
  for (const item of report.perRouteDiagnostic) {
    assert.equal(item.alternativeCandidates.length >= 1 || Boolean(item.explicitBlocker), true);
  }
});
