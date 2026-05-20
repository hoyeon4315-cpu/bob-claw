import test from "node:test";
import assert from "node:assert/strict";

import { buildLaneIntentCandidateReport } from "../src/strategy/remediation-lane-intent-candidate.mjs";

// Precise WAITLIST_BELOW_ROUTE_MINIMUM proof via amount-floor evidence. When
// the readiness surface reports a current-method blocker for the same
// source/destination tuple the planner intended to use, AND that blocker
// carries `quoteAmountFloor: { minimum, actual }` plus
// `routeDeferralReason: "bridge_quote_amount_below_minimum"`, the lifecycle
// must classify the lane as `WAITLIST_BELOW_ROUTE_MINIMUM` (typed waitlist,
// not vague NO_LIVE_ROUTE) and forward `attemptedAmount`, `minimumAmount`, and
// real-producer quote-cost fields. canIntent stays false; no live authority
// is implied. Synthetic chain/asset/method strings prove no target literal
// is required.

function syntheticHandlerReport({ plannerBlocker = null, intentOverrides = {} } = {}) {
  const source = intentOverrides.source || { chain: "synSrcChain", asset: "SYN_SRC", token: "0x0", estimatedUsd: 10 };
  const destination = intentOverrides.destination || {
    chain: "synDstChain",
    asset: "SYN_DST",
    token: "0xdest",
    targetAmount: "10000",
    targetAmountDecimal: 0.0001,
    estimatedAssetValueUsd: 9,
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
          selectedMethod: "synthetic_route_method",
          plannerCandidateMethods: ["synthetic_route_method"],
          source,
          destination,
          expectedNetUsd: "expectedNetUsd" in intentOverrides ? intentOverrides.expectedNetUsd : 0.5,
          requiredNetUsd: "requiredNetUsd" in intentOverrides ? intentOverrides.requiredNetUsd : null,
          p90CostUsd: "p90CostUsd" in intentOverrides ? intentOverrides.p90CostUsd : null,
          effectiveFloorUsd: "effectiveFloorUsd" in intentOverrides ? intentOverrides.effectiveFloorUsd : null,
          policyCaps: intentOverrides.policyCaps || {},
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
          governingAgreement: {
            queueLane: "capital_refill",
            plannerDecision: "REFILL_REQUIRED",
            jobDecision: "REFILL_REQUIRED",
            selectionStatus: "ready",
            agrees: false,
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

test("amount-floor evidence on tuple-matched readiness blocker yields WAITLIST_BELOW_ROUTE_MINIMUM", () => {
  // Planner intent supplies `expectedNetUsd` (so missingEvidence at the
  // candidate-evidence layer stays empty) but does NOT supply the cost-floor
  // numerics. The governing-sync rule in `belowRouteMinimumEvidence` therefore
  // drops `expectedNetUsd` from the missing-USD list (planner side has it)
  // while keeping `requiredNetUsd`, `p90CostUsd`, and `effectiveFloorUsd`
  // missing on both producer sides.
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport(),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
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
            gatewaySuccessProbe: {
              amount: "25000",
              outputAmount: "8897000000000000",
              fees: "225000",
              executionFees: "215000",
              feeRatio: 9.0,
              observedAt: "2026-05-20T02:27:45.463Z",
            },
            stalePlannerMethod: false,
          },
        ],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "WAITLIST_BELOW_ROUTE_MINIMUM");
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.canLive, false);
  assert.equal(candidate.reportOnly, true);
  assert.equal(candidate.nextAutomationStep, "wait_for_input_amount_to_meet_route_minimum_without_live_authority");
  assert.ok(candidate.belowRouteMinimum, "expected belowRouteMinimum evidence");
  assert.equal(candidate.belowRouteMinimum.method, "synthetic_route_method");
  assert.equal(candidate.belowRouteMinimum.amountFloorEvidence[0].minimum, "25000");
  assert.equal(candidate.belowRouteMinimum.amountFloorEvidence[0].actual, "10000");
  // Route/quote truth not constants
  assert.equal(candidate.attemptedAmount, "10000");
  assert.equal(candidate.minimumAmount, "25000");
  // Forwarded quote-cost from real producer (gatewaySuccessProbe)
  assert.equal(candidate.quoteCost[0].amount, "25000");
  assert.equal(candidate.quoteCost[0].outputAmount, "8897000000000000");
  assert.equal(candidate.quoteCost[0].fees, "225000");
  assert.equal(candidate.quoteCost[0].executionFees, "215000");
  assert.equal(candidate.quoteCost[0].feeRatio, 9.0);
  // USD cost-floor source absent on blocker; planner intent supplies
  // expectedNetUsd so governing-sync drops it from missing. The remaining
  // three USD floor fields are absent on both producer sides.
  assert.ok(!candidate.missingUsdCostFloorFields.includes("expectedNetUsd"));
  assert.ok(candidate.missingUsdCostFloorFields.includes("requiredNetUsd"));
  assert.ok(candidate.missingUsdCostFloorFields.includes("p90CostUsd"));
  assert.ok(candidate.missingUsdCostFloorFields.includes("effectiveFloorUsd"));
  // Back-compat alias for downstream consumers
  assert.equal(candidate.noLiveRouteByAmountFloor, candidate.belowRouteMinimum);
});

test("safe capital above route minimum produces report-only proposedSizedAmount without canLive", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport({
      intentOverrides: {
        source: {
          chain: "synSrcChain",
          asset: "SYN_SRC",
          token: "0x0",
          actual: "50000",
          actualDecimal: 0.0005,
          estimatedUsd: 45,
          sourceKind: "token",
        },
        requiredNetUsd: 0.2,
        p90CostUsd: 0.1,
        effectiveFloorUsd: 0.2,
        policyCaps: { perTxUsd: 30, perDayUsd: 60, maxDailyLossUsd: 10 },
        paybackReserve: { reserveSats: "1000", reason: "synthetic_payback_reserve" },
        gasReserve: { reserveSats: "1000", reason: "synthetic_gas_reserve" },
      },
    }),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
            chain: "synDstChain",
            asset: "SYN_DST",
            sourceChain: "synSrcChain",
            sourceAsset: "SYN_SRC",
            selectedMethod: "synthetic_route_method",
            reason: "quote_amount_too_low",
            category: "quote_amount_below_minimum",
            routeDeferralReason: "bridge_quote_amount_below_minimum",
            quoteAmountFloor: { minimum: "25000", actual: "10000" },
            gatewaySuccessProbe: { amount: "25000", outputAmount: "1", fees: "1", executionFees: "1", feeRatio: 0.01 },
            expectedNetUsd: 0.5,
            requiredNetUsd: 0.2,
            p90CostUsd: 0.1,
            effectiveFloorUsd: 0.2,
            stalePlannerMethod: false,
          },
        ],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "READY_FOR_INTENT_CANDIDATE");
  assert.equal(candidate.canIntent, true);
  assert.equal(candidate.canLive, false);
  assert.equal(candidate.reportOnly, true);
  assert.equal(candidate.runtimeAuthority, "none");
  assert.equal(candidate.attemptedAmountSats, "10000");
  assert.equal(candidate.minRouteAmountSats, "25000");
  assert.equal(candidate.proposedSizedAmountSats, "25000");
  assert.equal(candidate.availableSourceAmountSats, "50000");
  assert.equal(candidate.availableAfterPaybackReserveSats, "49000");
  assert.equal(candidate.availableAfterGasReserveSats, "48000");
  assert.equal(candidate.sizingDecision, "REPORT_ONLY_SIZED_TO_ROUTE_MINIMUM");
  assert.equal(candidate.sizingBlocker, null);
});

test("insufficient reserve/cap emits typed waitlist with exact sizing deficit", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport({
      intentOverrides: {
        source: { chain: "synSrcChain", asset: "SYN_SRC", token: "0x0", actual: "24000", estimatedUsd: 21.6 },
        requiredNetUsd: 0.2,
        p90CostUsd: 0.1,
        effectiveFloorUsd: 0.2,
        policyCaps: { perTxUsd: 30, perDayUsd: 60, maxDailyLossUsd: 10 },
      },
    }),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
            chain: "synDstChain",
            asset: "SYN_DST",
            sourceChain: "synSrcChain",
            sourceAsset: "SYN_SRC",
            selectedMethod: "synthetic_route_method",
            reason: "quote_amount_too_low",
            category: "quote_amount_below_minimum",
            routeDeferralReason: "bridge_quote_amount_below_minimum",
            quoteAmountFloor: { minimum: "25000", actual: "10000" },
            expectedNetUsd: 0.5,
            requiredNetUsd: 0.2,
            p90CostUsd: 0.1,
            effectiveFloorUsd: 0.2,
            stalePlannerMethod: false,
          },
        ],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  // Cap/reserve insufficiency is its own truthful lifecycle state distinct
  // from pure inventory-below-route-minimum: committed policy caps clamp
  // safe-allocatable below the route minimum. The sizingBlocker still carries
  // `safe_allocatable_capital_below_route_minimum`; no cap is relaxed.
  assert.equal(candidate.status, "INSUFFICIENT_CAP_OR_RESERVE");
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.canLive, false);
  assert.equal(candidate.reportOnly, true);
  assert.equal(candidate.runtimeAuthority, "none");
  assert.equal(candidate.proposedSizedAmountSats, null);
  assert.equal(candidate.safeAllocatableAmountSats, "24000");
  assert.equal(candidate.sizingDeficitSats, "1000");
  assert.equal(candidate.sizingBlocker, "safe_allocatable_capital_below_route_minimum");
  assert.equal(
    candidate.nextAutomationStep,
    "wait_for_safe_allocatable_capital_to_meet_route_minimum_without_live_authority",
  );
});

test("safe sizing without USD cost-floor blocks canIntent with exact missing fields", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport({
      intentOverrides: {
        source: { chain: "synSrcChain", asset: "SYN_SRC", token: "0x0", actual: "50000", estimatedUsd: 45 },
        policyCaps: { perTxUsd: 30, perDayUsd: 60, maxDailyLossUsd: 10 },
      },
    }),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
            chain: "synDstChain",
            asset: "SYN_DST",
            sourceChain: "synSrcChain",
            sourceAsset: "SYN_SRC",
            selectedMethod: "synthetic_route_method",
            reason: "quote_amount_too_low",
            category: "quote_amount_below_minimum",
            routeDeferralReason: "bridge_quote_amount_below_minimum",
            quoteAmountFloor: { minimum: "25000", actual: "10000" },
            gatewaySuccessProbe: { amount: "25000", outputAmount: "1", fees: "1", executionFees: "1", feeRatio: 0.01 },
            stalePlannerMethod: false,
          },
        ],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "QUOTE_COST_FIELDS_MISSING");
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.proposedSizedAmountSats, "25000");
  assert.equal(candidate.quoteCostFieldsMissing.missingUsdCostFloorProducer, "src/treasury/refill-job.mjs");
  assert.ok(candidate.missingUsdCostFloorFields.includes("requiredNetUsd"));
  assert.ok(candidate.missingUsdCostFloorFields.includes("p90CostUsd"));
  assert.ok(candidate.missingUsdCostFloorFields.includes("effectiveFloorUsd"));
});

test("amount-floor without minimum string falls back to TYPED_MISSING_EVIDENCE", () => {
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport(),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
            chain: "synDstChain",
            asset: "SYN_DST",
            sourceChain: "synSrcChain",
            sourceAsset: "SYN_SRC",
            selectedMethod: "synthetic_route_method",
            reason: "quote_amount_too_low",
            category: "quote_amount_below_minimum",
            routeDeferralReason: "bridge_quote_amount_below_minimum",
            quoteAmountFloor: null,
            stalePlannerMethod: false,
          },
        ],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "TYPED_MISSING_EVIDENCE");
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.canLive, false);
  assert.equal(candidate.belowRouteMinimum, null);
  assert.equal(candidate.noLiveRouteByAmountFloor, null);
});

// Anti-overfit: unrelated synthetic chain/asset/method tuples must each
// resolve to WAITLIST_BELOW_ROUTE_MINIMUM purely from quote/route truth. No
// hardcoded 10000/25000/Gateway/BTC/Base/wBTC reference is required.
const ANTI_OVERFIT_TUPLES = [
  {
    label: "tuple_alpha",
    selectedMethod: "alpha_bridge_method",
    source: { chain: "alphaSrc", asset: "ALPHA_SRC", token: "0xa1" },
    destination: {
      chain: "alphaDst",
      asset: "ALPHA_DST",
      token: "0xa2",
      targetAmount: "44",
      minimum: "777",
      actual: "44",
    },
  },
  {
    label: "tuple_beta",
    selectedMethod: "beta_swap_method",
    source: { chain: "betaSrc", asset: "BETA_SRC", token: "0xb1" },
    destination: {
      chain: "betaDst",
      asset: "BETA_DST",
      token: "0xb2",
      targetAmount: "300",
      minimum: "999000",
      actual: "300",
    },
  },
];

for (const tuple of ANTI_OVERFIT_TUPLES) {
  test(`anti-overfit ${tuple.label}: route/quote truth drives WAITLIST_BELOW_ROUTE_MINIMUM`, () => {
    const handlerReport = {
      selectedPilotLane: "capital_refill",
      status: "LANE_HANDLER_PILOT_READY",
      handlerResults: [
        {
          lane: "capital_refill",
          family: `${tuple.label}_family`,
          sourceQueueItem: {
            lane: "capital_refill",
            family: `${tuple.label}_family`,
            governingFieldPath: `familyCoverage[family=${tuple.label}_family].firstBlockingReason`,
            canDryRun: true,
            safetyBlockers: [],
          },
          status: "READY_FOR_DRY_RUN",
          canDryRun: true,
          dryRunIntent: {
            intentType: "capital_refill_dry_run",
            selectedMethod: tuple.selectedMethod,
            plannerCandidateMethods: [tuple.selectedMethod],
            source: { ...tuple.source, estimatedUsd: 10 },
            destination: {
              chain: tuple.destination.chain,
              asset: tuple.destination.asset,
              token: tuple.destination.token,
              targetAmount: tuple.destination.targetAmount,
              targetAmountDecimal: Number(tuple.destination.targetAmount) / 1e8,
              estimatedAssetValueUsd: 9,
            },
            expectedNetUsd: 0.5,
            costs: {
              expectedExecutionRefillCostUsd: 0.4,
              expectedReserveReplenishmentCostUsd: 0,
              bridgeQuoteCostUsd: 0.4,
              bridgeQuoteCostCeilingUsd: 1.0,
              routeKnownCostUsd: 0.2,
            },
            blocker: null,
            governingAgreement: {
              queueLane: "capital_refill",
              plannerDecision: "REFILL_REQUIRED",
              jobDecision: "REFILL_REQUIRED",
              selectionStatus: "ready",
              agrees: false,
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
    };
    const report = buildLaneIntentCandidateReport({
      laneHandlerReport: handlerReport,
      readinessReport: {
        liveAutomation: {
          refillBlockers: [
            {
              chain: tuple.destination.chain,
              asset: tuple.destination.asset,
              sourceChain: tuple.source.chain,
              sourceAsset: tuple.source.asset,
              selectedMethod: tuple.selectedMethod,
              reason: "quote_amount_too_low",
              category: "quote_amount_below_minimum",
              routeDeferralReason: "bridge_quote_amount_below_minimum",
              quoteAmountFloor: { minimum: tuple.destination.minimum, actual: tuple.destination.actual },
              stalePlannerMethod: false,
            },
          ],
        },
      },
    });
    const candidate = report.laneIntentCandidates[0];
    assert.equal(candidate.status, "WAITLIST_BELOW_ROUTE_MINIMUM");
    assert.equal(candidate.canIntent, false);
    assert.equal(candidate.canLive, false);
    assert.equal(candidate.attemptedAmount, tuple.destination.actual);
    assert.equal(candidate.minimumAmount, tuple.destination.minimum);
    assert.equal(candidate.belowRouteMinimum.method, tuple.selectedMethod);
  });
}

// Quote-cost forwarded fields must originate from the readiness producer
// (`gatewaySuccessProbe`). With no probe the candidate must not invent quote
// fields and must keep the missing-fields list populated.
test("no gatewaySuccessProbe => quoteCost array empty and USD floor flagged missing", () => {
  // Planner intent has expectedNetUsd (default) but not the cost-floor
  // numerics; the blocker also lacks them. Governing-sync keeps the three
  // genuinely-absent fields in the missing list while dropping
  // `expectedNetUsd` which the planner supplies.
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport(),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
            chain: "synDstChain",
            asset: "SYN_DST",
            sourceChain: "synSrcChain",
            sourceAsset: "SYN_SRC",
            selectedMethod: "synthetic_route_method",
            reason: "quote_amount_too_low",
            category: "quote_amount_below_minimum",
            routeDeferralReason: "bridge_quote_amount_below_minimum",
            quoteAmountFloor: { minimum: "111", actual: "22" },
            stalePlannerMethod: false,
          },
        ],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "WAITLIST_BELOW_ROUTE_MINIMUM");
  assert.equal(candidate.canIntent, false);
  assert.deepEqual(candidate.quoteCost, []);
  assert.ok(!candidate.missingUsdCostFloorFields.includes("expectedNetUsd"));
  assert.ok(candidate.missingUsdCostFloorFields.includes("requiredNetUsd"));
  assert.ok(candidate.missingUsdCostFloorFields.includes("p90CostUsd"));
  assert.ok(candidate.missingUsdCostFloorFields.includes("effectiveFloorUsd"));
});

test("amount-floor mismatched on different selectedMethod stays out of NO_LIVE_ROUTE", () => {
  // Blocker carries a *different* selectedMethod than the planner intent. The
  // tuple match is method-aware, so this blocker is not considered a
  // current-method collision and the amount-floor path does not activate.
  const report = buildLaneIntentCandidateReport({
    laneHandlerReport: syntheticHandlerReport(),
    readinessReport: {
      liveAutomation: {
        refillBlockers: [
          {
            chain: "synDstChain",
            asset: "SYN_DST",
            sourceChain: "synSrcChain",
            sourceAsset: "SYN_SRC",
            selectedMethod: "different_synthetic_method",
            reason: "quote_amount_too_low",
            category: "quote_amount_below_minimum",
            routeDeferralReason: "bridge_quote_amount_below_minimum",
            quoteAmountFloor: { minimum: "9999", actual: "111" },
            stalePlannerMethod: false,
          },
        ],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.notEqual(candidate.status, "NO_LIVE_ROUTE");
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.canLive, false);
});
