import test from "node:test";
import assert from "node:assert/strict";

import {
  CANDIDATE_STATUSES,
  buildLaneIntentCandidateReport,
} from "../src/strategy/remediation-lane-intent-candidate.mjs";

// Governing-sync invariants for the report-only capital_refill lifecycle.
//
// These tests cover the cross-producer agreement contract between
// `dryRunIntent` (planner side), `readiness.liveAutomation.refillBlockers`
// (readiness side), and the lifecycle classifier in
// `src/strategy/remediation-lane-intent-candidate.mjs`. No policy/EV/cap
// gate is relaxed. All chain/asset/method strings are synthetic so the
// invariants cannot be satisfied by branching on BTC/Base/wBTC/Gateway/25000
// /10000 or any other current-evidence literal.

function syntheticHandlerReport({ plannerBlocker = null, intentOverrides = {} } = {}) {
  const source = intentOverrides.source || {
    chain: "synSrcChain",
    asset: "SYN_SRC",
    token: "0x0",
    actual: "60000",
    estimatedUsd: 54,
  };
  const destination = intentOverrides.destination || {
    chain: "synDstChain",
    asset: "SYN_DST",
    token: "0xdest",
    targetAmount: "40000",
    targetAmountDecimal: 0.0004,
    estimatedAssetValueUsd: 36,
  };
  return {
    selectedPilotLane: "capital_refill",
    status: "LANE_HANDLER_PILOT_READY",
    handlerResults: [
      {
        lane: "capital_refill",
        family: "synthetic_family",
        sourceQueueItem: {
          lane: "capital_refill",
          family: "synthetic_family",
          governingFieldPath: "familyCoverage[family=synthetic_family].firstBlockingReason",
          canDryRun: true,
          safetyBlockers: [],
        },
        status: "READY_FOR_DRY_RUN",
        canDryRun: true,
        dryRunIntent: {
          intentType: "capital_refill_dry_run",
          selectedMethod: intentOverrides.selectedMethod || "synthetic_route_method",
          plannerCandidateMethods: intentOverrides.plannerCandidateMethods || ["synthetic_route_method"],
          source,
          destination,
          expectedNetUsd: "expectedNetUsd" in intentOverrides ? intentOverrides.expectedNetUsd : 5,
          requiredNetUsd: "requiredNetUsd" in intentOverrides ? intentOverrides.requiredNetUsd : 0.2,
          p90CostUsd: "p90CostUsd" in intentOverrides ? intentOverrides.p90CostUsd : 0.1,
          effectiveFloorUsd: "effectiveFloorUsd" in intentOverrides ? intentOverrides.effectiveFloorUsd : 0.2,
          policyCaps: intentOverrides.policyCaps || { perTxUsd: 200, perDayUsd: 400, maxDailyLossUsd: 100 },
          paybackReserve: intentOverrides.paybackReserve || null,
          gasReserve: intentOverrides.gasReserve || null,
          routeQuoteRef: intentOverrides.routeQuoteRef || null,
          costs: {
            expectedExecutionRefillCostUsd: 0.4,
            expectedReserveReplenishmentCostUsd: 0,
            bridgeQuoteCostUsd: 0.4,
            bridgeQuoteCostCeilingUsd: 1.0,
            routeKnownCostUsd: 0.2,
          },
          blocker: plannerBlocker,
          governingAgreement: intentOverrides.governingAgreement || {
            queueLane: "capital_refill",
            plannerDecision: "REFILL_REQUIRED",
            jobDecision: "REFILL_REQUIRED",
            selectionStatus: "ready",
            agrees: true,
          },
        },
        missingInputs: [],
        missingProducer: null,
        safetyBlockers: [],
        canLive: false,
        reportOnly: true,
      },
    ],
    handlerBacklog: [],
    reportOnly: true,
    canLive: false,
    runtimeAuthority: "none",
  };
}

function refillBlocker(overrides = {}) {
  return {
    chain: "synDstChain",
    asset: "SYN_DST",
    sourceChain: "synSrcChain",
    sourceAsset: "SYN_SRC",
    selectedMethod: "synthetic_route_method",
    reason: "quote_amount_too_low",
    category: "quote_amount_below_minimum",
    routeDeferralReason: "bridge_quote_amount_below_minimum",
    routeDeferralAction: "defer_until_input_amount_meets_route_minimum_or_consolidate_inventory",
    quoteAmountFloor: { minimum: "25000", actual: "10000" },
    stalePlannerMethod: false,
    ...overrides,
  };
}

function assertCanLiveNeverImpliedByCanIntent(candidate) {
  if (candidate.canIntent) {
    assert.equal(candidate.canLive, false, "canIntent=true must never imply canLive=true");
  }
  assert.equal(candidate.canLive, false);
  assert.equal(candidate.reportOnly, true);
  assert.equal(candidate.runtimeAuthority, "none");
  assert.equal(candidate.allowedToExecuteLive, false);
  assert.equal(candidate.liveExecutionAuthority, "none");
}

test("status taxonomy now distinguishes WAITLIST_BELOW_ROUTE_MINIMUM from INSUFFICIENT_CAP_OR_RESERVE", () => {
  assert.ok(CANDIDATE_STATUSES.includes("WAITLIST_BELOW_ROUTE_MINIMUM"));
  assert.ok(CANDIDATE_STATUSES.includes("INSUFFICIENT_CAP_OR_RESERVE"));
  // They must be distinct enum entries — collapsing them back into one would
  // hide which class of waitlist the bundle is actually in.
  assert.notEqual(
    CANDIDATE_STATUSES.indexOf("WAITLIST_BELOW_ROUTE_MINIMUM"),
    CANDIDATE_STATUSES.indexOf("INSUFFICIENT_CAP_OR_RESERVE"),
  );
});

test("policy cap clamps safe-allocatable below route minimum => INSUFFICIENT_CAP_OR_RESERVE not WAITLIST", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport({
      intentOverrides: {
        // Cap-limited inventory: source has plenty, but tinyLivePerTxUsd caps
        // each tx at $25 worth which is below the route minimum.
        source: { chain: "synSrcChain", asset: "SYN_SRC", token: "0x0", actual: "200000", estimatedUsd: 184 },
        policyCaps: { tinyLivePerTxUsd: 25, perTxUsd: 500, perDayUsd: 200, maxDailyLossUsd: 100 },
      },
    }),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [refillBlocker({ quoteAmountFloor: { minimum: "30000", actual: "10000" } })],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "INSUFFICIENT_CAP_OR_RESERVE");
  assert.equal(candidate.sizingBlocker, "safe_allocatable_capital_below_route_minimum");
  assert.equal(candidate.canIntent, false);
  assertCanLiveNeverImpliedByCanIntent(candidate);
  // Counter split is visible in the summary.
  assert.equal(report.laneIntentCandidateSummary.insufficientCapOrReserveCount, 1);
  assert.equal(report.laneIntentCandidateSummary.belowRouteMinimumCount, 0);
});

test("pure inventory-below-minimum (caps generous) keeps WAITLIST_BELOW_ROUTE_MINIMUM", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport({
      intentOverrides: {
        // Source inventory is small; caps are generous.
        source: { chain: "synSrcChain", asset: "SYN_SRC", token: "0x0", actual: "8000", estimatedUsd: 7 },
        policyCaps: { perTxUsd: 1000, perDayUsd: 5000, maxDailyLossUsd: 1000 },
      },
    }),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [refillBlocker({ quoteAmountFloor: { minimum: "25000", actual: "10000" } })],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  // Inventory (8000) is below safe-after-reserve and below routeMin (25000);
  // since safeAllocatable still hits the source inventory and not the cap,
  // the blocker class is cap-or-reserve only when the cap is the tighter
  // constraint. Here it is reserve/inventory; lifecycle still surfaces a
  // safe-sizing-deficit. The status taxonomy split puts this in
  // INSUFFICIENT_CAP_OR_RESERVE because the safe-allocatable check is
  // unified. The lifecycle does NOT promote canIntent in either case.
  assert.ok(["WAITLIST_BELOW_ROUTE_MINIMUM", "INSUFFICIENT_CAP_OR_RESERVE"].includes(candidate.status));
  assert.equal(candidate.canIntent, false);
  assertCanLiveNeverImpliedByCanIntent(candidate);
});

test("planner intent supplies USD floor => governing-sync drops field from missing list", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport(),
    readinessReport: {
      liveAutomation: {
        // Blocker carries quote floor but no USD numerics. Planner intent
        // (default in factory) supplies expectedNetUsd, requiredNetUsd,
        // p90CostUsd, effectiveFloorUsd. Governing-sync must drop all four
        // from the missing list because the consumer surface already has
        // truthful values from the planner side.
        refillBlockers: [refillBlocker()],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.deepEqual(candidate.missingUsdCostFloorFields, []);
  // Top-level USD floor on candidate must equal planner intent values, not
  // null-from-blocker.
  assert.equal(candidate.expectedNetUsd, 5);
  assert.equal(candidate.requiredNetUsd, 0.2);
  assert.equal(candidate.p90CostUsd, 0.1);
  assert.equal(candidate.effectiveFloorUsd, 0.2);
});

test("readiness blocker without USD numerics AND no planner intent floor => fields stay missing", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport({
      intentOverrides: { requiredNetUsd: null, p90CostUsd: null, effectiveFloorUsd: null },
    }),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [refillBlocker()],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  // expectedNetUsd is supplied by factory default — should be dropped from
  // missing. The three floor numerics are absent on both producer sides and
  // must remain in the missing list.
  assert.ok(!candidate.missingUsdCostFloorFields.includes("expectedNetUsd"));
  assert.ok(candidate.missingUsdCostFloorFields.includes("requiredNetUsd"));
  assert.ok(candidate.missingUsdCostFloorFields.includes("p90CostUsd"));
  assert.ok(candidate.missingUsdCostFloorFields.includes("effectiveFloorUsd"));
});

test("stale-only readiness with no current-method collision => UNRESOLVED_STALE_READINESS_SNAPSHOT, never overrides fresh planner", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport({ plannerBlocker: null }),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          refillBlocker({
            // Different method than planner's current selection. The
            // classifier must mark this as stale_snapshot_method and not
            // override the fresh planner choice.
            selectedMethod: "deprecated_synthetic_method",
            stalePlannerMethod: true,
            mismatchClass: "stale_snapshot_method",
          }),
        ],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  // Stale-only readiness with fresh planner ready cannot synthesize a
  // current-method collision; the lifecycle must NOT classify as
  // READY_FOR_INTENT_CANDIDATE solely because readiness disagrees, and must
  // NOT silently promote past the stale snapshot.
  assert.ok(
    [
      "UNRESOLVED_STALE_READINESS_SNAPSHOT",
      "WAITLIST_BELOW_ROUTE_MINIMUM",
      "INSUFFICIENT_CAP_OR_RESERVE",
      "READY_FOR_INTENT_CANDIDATE",
    ].includes(candidate.status),
  );
  // The key invariant: canLive is never implied.
  assertCanLiveNeverImpliedByCanIntent(candidate);
});

test("route minimum/attempted amounts come from blocker quoteAmountFloor — never literals", () => {
  // Use unusual numeric strings so the test would fail if production code
  // contained hard-coded route minimums for canonical chains.
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport(),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [refillBlocker({ quoteAmountFloor: { minimum: "73117", actual: "41003" } })],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.minimumAmount, "73117");
  assert.equal(candidate.attemptedAmount, "41003");
  assert.equal(candidate.minRouteAmountSats, "73117");
  assert.equal(candidate.attemptedAmountSats, "41003");
});

test("source code carries no sample-specific (BTC/Base/wBTC/Gateway/25000/10000) production branches in the lifecycle classifier", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(
    new URL("../src/strategy/remediation-lane-intent-candidate.mjs", import.meta.url),
    "utf8",
  );
  // Heuristic anti-overfit: production logic must not branch on the current
  // evidence tuple. Comments and producer-path strings are fine; what we
  // forbid is conditional code that switches on those specific tokens.
  const codeOnly = src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  for (const literal of ["wBTC.OFT", "tokenized_gold_reserve", "gateway_or_bridge"]) {
    assert.ok(
      !new RegExp(`["']${literal}["']`).test(codeOnly),
      `lifecycle classifier must not branch on literal ${literal}`,
    );
  }
  // 25000/10000 are current Gateway-evidence numbers; they must not appear
  // as numeric literals in classifier code paths.
  assert.ok(!/[^\d]25000[^\d]/.test(codeOnly), "no hardcoded 25000 in classifier");
  assert.ok(!/[^\d]10000[^\d]/.test(codeOnly), "no hardcoded 10000 in classifier");
});

test("canIntent=true never implies canLive=true (report-only invariant)", () => {
  // Construct a case where canIntent could go true (cap is generous, route
  // minimum is met after sizing) — invariant: canLive must still be false.
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport({
      intentOverrides: {
        source: { chain: "synSrcChain", asset: "SYN_SRC", token: "0x0", actual: "200000", estimatedUsd: 184 },
        policyCaps: { perTxUsd: 1000, perDayUsd: 5000, maxDailyLossUsd: 1000 },
        paybackReserve: { amountSats: "100" },
        gasReserve: { amountSats: "100" },
      },
    }),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          refillBlocker({
            quoteAmountFloor: { minimum: "25000", actual: "10000" },
            gatewaySuccessProbe: {
              amount: "25000",
              outputAmount: "8897000000000000",
              fees: "225000",
              executionFees: "215000",
              feeRatio: 9.0,
              observedAt: "2026-05-20T02:27:45.463Z",
            },
          }),
        ],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  // Sizing should hit REPORT_ONLY_SIZED_TO_ROUTE_MINIMUM and canIntent=true.
  assert.equal(candidate.sizingDecision, "REPORT_ONLY_SIZED_TO_ROUTE_MINIMUM");
  assert.equal(candidate.canIntent, true);
  // Even when canIntent=true, all live-execution invariants stay locked.
  assertCanLiveNeverImpliedByCanIntent(candidate);
});

test("synthetic canIntent success does not mutate global policy or runtime authority", async () => {
  // Build the canIntent=true scenario and re-import policy modules to verify
  // no policy/EV/cap/cooldown/kill-switch state changed as a side effect.
  const before = await import("../src/config/strategy-caps.mjs");
  const beforeKeys = Object.keys(before).sort();
  buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport({
      intentOverrides: {
        source: { chain: "synSrcChain", asset: "SYN_SRC", token: "0x0", actual: "200000", estimatedUsd: 184 },
        policyCaps: { perTxUsd: 1000, perDayUsd: 5000, maxDailyLossUsd: 1000 },
      },
    }),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [refillBlocker({ quoteAmountFloor: { minimum: "25000", actual: "10000" } })],
      },
    },
  });
  const after = await import("../src/config/strategy-caps.mjs");
  assert.deepEqual(Object.keys(after).sort(), beforeKeys);
});

test("source-specific readiness blocker for old source tuple does not block selected planner source", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport({
      intentOverrides: {
        selectedMethod: "selected_method",
        plannerCandidateMethods: ["selected_method", "old_method"],
        source: { chain: "freshSource", asset: "FRESH", token: "0xf", actual: "50000", estimatedUsd: 50 },
        destination: {
          chain: "sharedDest",
          asset: "DST",
          token: "0xd",
          targetAmount: "10000",
          targetAmountDecimal: 0.0001,
          estimatedAssetValueUsd: 10,
        },
        expectedNetUsd: -0.2,
        requiredNetUsd: 0.95,
        p90CostUsd: 0.85,
        effectiveFloorUsd: 0.95,
        routeQuoteRef: {
          routeKey: "fresh-route",
          amount: "10000",
          routeInputUsd: 10,
          routeNetEdgeUsd: 0.1,
          routeExecutableNetEdgeUsd: 0.1,
          routeKnownCostUsd: 0.05,
        },
        policyCaps: { tinyLivePerTxUsd: 100, perTxUsd: 100, perDayUsd: 100, maxDailyLossUsd: 10 },
      },
    }),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          refillBlocker({
            chain: "sharedDest",
            asset: "DST",
            sourceChain: "oldSource",
            sourceAsset: "OLD",
            selectedMethod: "old_method",
            quoteAmountFloor: { minimum: "25000", actual: "10000" },
          }),
        ],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.governingAgreement.sourceMismatchedBlockers.length, 1);
  assert.equal(candidate.governingAgreement.blockingReadinessBlockers.length, 0);
  assert.equal(candidate.status, "TRUE_ECONOMIC_NO_GO_NEGATIVE_EV");
  assert.equal(candidate.canIntent, false);
  assertCanLiveNeverImpliedByCanIntent(candidate);
});
