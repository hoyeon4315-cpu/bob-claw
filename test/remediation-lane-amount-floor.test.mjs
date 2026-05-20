import test from "node:test";
import assert from "node:assert/strict";

import { buildLaneIntentCandidateReport } from "../src/strategy/remediation-lane-intent-candidate.mjs";

// Precise NO_LIVE_ROUTE proof via amount-floor evidence. When the readiness
// surface reports a current-method blocker for the same source/destination
// tuple the planner intended to use, AND that blocker carries
// `quoteAmountFloor: { minimum, actual }` plus
// `routeDeferralReason: "bridge_quote_amount_below_minimum"`, the lifecycle
// must classify the lane as NO_LIVE_ROUTE (complete amount-floor proof) rather
// than TYPED_MISSING_EVIDENCE (cost-floor numerics missing). canIntent stays
// false; no live authority is implied. Synthetic chain/asset/method strings
// prove no target literal is required.

function syntheticHandlerReport({ plannerBlocker = null } = {}) {
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
          source: { chain: "synSrcChain", asset: "SYN_SRC", token: "0x0", estimatedUsd: 10 },
          destination: {
            chain: "synDstChain",
            asset: "SYN_DST",
            token: "0xdest",
            targetAmount: "10000",
            targetAmountDecimal: 0.0001,
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

test("amount-floor evidence on tuple-matched readiness blocker yields NO_LIVE_ROUTE", () => {
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
            stalePlannerMethod: false,
          },
        ],
      },
    },
  });
  const candidate = report.laneIntentCandidates[0];
  assert.equal(candidate.status, "NO_LIVE_ROUTE");
  assert.equal(candidate.canIntent, false);
  assert.equal(candidate.canLive, false);
  assert.equal(candidate.reportOnly, true);
  assert.equal(candidate.nextAutomationStep, "wait_for_input_amount_to_meet_route_minimum_without_live_authority");
  assert.ok(candidate.noLiveRouteByAmountFloor, "expected noLiveRouteByAmountFloor evidence");
  assert.equal(candidate.noLiveRouteByAmountFloor.method, "synthetic_route_method");
  assert.equal(candidate.noLiveRouteByAmountFloor.amountFloorEvidence[0].minimum, "25000");
  assert.equal(candidate.noLiveRouteByAmountFloor.amountFloorEvidence[0].actual, "10000");
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
  assert.equal(candidate.noLiveRouteByAmountFloor, null);
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
