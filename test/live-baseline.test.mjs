import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLiveBaselineSummary } from "../src/status/live-baseline.mjs";

test("live baseline summary classifies refresh, operator, technical, and objective blockers", () => {
  const summary = buildLiveBaselineSummary({
    dashboardStatus: {
      generatedAt: "2026-04-17T15:30:00.000Z",
      overall: {
        liveTrading: "BLOCKED",
        shadowTrading: "ALLOWED",
      },
      prelive: {
        currentStage: "shadow_replay",
        validation: {
          currentStageId: "shadow_replay",
        },
        connectedRefresh: {
          status: "network_refresh_required",
          routeLabel: "avalanche->ethereum wBTC.OFT->WBTC",
          routeKey: "avalanche:0x0555->ethereum:0x2260",
          amount: "10000",
          requiredRefreshCount: 5,
          staleInputCount: 5,
          missingInputCount: 0,
          nextActionCode: "refresh_gateway_quote",
          nextActionCommand: 'npm run verify:gateway -- --route-key="avalanche:0x0555->ethereum:0x2260" --amounts="10000"',
        },
        currentRoutePrelivePass: {
          latestStatus: "blocked_insufficient_data",
          nextAction: {
            code: "hold_negative_edge",
          },
        },
        exactRouteForkPackage: {
          status: "missing_exact_route_plan",
          technicalStatus: "missing_plan",
          economicStatus: "blocked_insufficient_data",
        },
        operationalJudgmentReview: {
          status: "guarded_blocked",
          issueCount: 3,
          highSeverityCount: 2,
        },
      },
      payback: {
        scheduler: {
          status: "blocked",
          reason: "payback_btc_destination_missing",
          requiredEnvName: "PAYBACK_BTC_DEST_ADDR",
          nextAction: "set_payback_btc_destination_env",
          previewAfterDestination: {
            reason: "planned_payback_below_minimum",
            grossTargetBeforeCostsSats: 56,
            minPaybackSats: 50000,
            satsToMinimumPayback: 49944,
          },
        },
      },
    },
    nextStep: {
      decision: "FUND_AND_APPROVE_WALLET",
      headline: "Fund and approve the estimator wallet before exact gas",
      route: {
        label: "avalanche->ethereum wBTC.OFT->WBTC",
        routeKey: "avalanche:0x0555->ethereum:0x2260",
        amount: "10000",
      },
      reasons: ["token"],
      actions: [
        {
          type: "fund_token",
          chain: "avalanche",
          ticker: "wBTC.OFT",
          shortfallDecimal: 0.0001,
        },
      ],
    },
  });

  assert.equal(summary.status, "blocked");
  assert.equal(summary.currentStageId, "shadow_replay");
  assert.equal(summary.route?.routeLabel, "avalanche->ethereum wBTC.OFT->WBTC");
  assert.equal(summary.counts.requiredRefreshCount, 5);
  assert.equal(summary.counts.refresh, 1);
  assert.equal(summary.counts.operator, 2);
  assert.equal(summary.counts.technical, 1);
  assert.equal(summary.counts.objective, 2);
  assert.equal(summary.nextAction?.category, "refresh");
  assert.equal(summary.nextAction?.code, "refresh_gateway_quote");
  assert.equal(summary.blockers.operator[0].actions[0].summary, "fund 0.0001 wBTC.OFT on avalanche");
  assert.equal(summary.observations.paybackMinimumProgress.remainingSats, 49944);
});

test("live baseline treats current below-minimum payback state as carry observation", () => {
  const summary = buildLiveBaselineSummary({
    dashboardStatus: {
      overall: {
        liveTrading: "ALLOWED",
        shadowTrading: "ALLOWED",
      },
      payback: {
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
          minimumPaybackProgress: {
            source: "current",
            status: "carry",
            reason: "planned_payback_below_minimum",
            grossTargetBeforeCostsSats: 58,
            minPaybackSats: 50_000,
            satsToMinimumPayback: 49_942,
          },
        },
      },
    },
  });

  assert.equal(summary.status, "ready");
  assert.equal(summary.counts.objective, 0);
  assert.equal(summary.observations.paybackMinimumProgress.reason, "planned_payback_below_minimum");
  assert.equal(summary.observations.paybackMinimumProgress.remainingSats, 49_942);
  assert.equal(summary.observations.paybackMinimumProgress.progressSource, "current");
});

test("live baseline suppresses secondary route blockers when a strategy candidate is primary", () => {
  const summary = buildLiveBaselineSummary({
    dashboardStatus: {
      generatedAt: "2026-04-19T00:00:00.000Z",
      overall: {
        liveTrading: "BLOCKED",
        shadowTrading: "ALLOWED",
      },
      prelive: {
        currentStage: "tiny_live_canary_review",
        reviewPackage: {
          candidateType: "strategy",
          candidateId: "wrapped-btc-loop-base-moonwell",
          candidateLabel: "Wrapped BTC lending loop (Base / Moonwell)",
        },
        validation: {
          currentStageId: "tiny_live_canary_review",
        },
        connectedRefresh: {
          status: "network_refresh_required",
          routeLabel: "base->ethereum wBTC.OFT->WBTC",
          routeKey: "base:0x0555->ethereum:0x2260",
          amount: "25000",
          requiredRefreshCount: 4,
          nextActionCode: "refresh_gateway_quote",
        },
        currentRoutePrelivePass: {
          latestStatus: "blocked_insufficient_data",
          nextAction: {
            code: "hold_negative_edge",
          },
        },
        exactRouteForkPackage: {
          status: "technical_ready_economic_blocked",
          technicalStatus: "submit_ready",
          economicStatus: "blocked_insufficient_data",
        },
        operationalJudgmentReview: {
          status: "guarded_blocked",
          issueCount: 2,
          highSeverityCount: 1,
          nextActionCode: "technical_ready_but_economic_blocked",
        },
      },
      payback: {
        scheduler: {
          status: "carry",
          reason: "planned_payback_below_minimum",
          minimumPaybackProgress: {
            source: "current",
            status: "carry",
            reason: "planned_payback_below_minimum",
            grossTargetBeforeCostsSats: 58,
            minPaybackSats: 50_000,
            satsToMinimumPayback: 49_942,
          },
        },
      },
    },
    nextStep: {
      decision: "FUND_AND_APPROVE_WALLET",
      headline: "Fund and approve the estimator wallet before exact gas",
      route: {
        label: "base->ethereum wBTC.OFT->WBTC",
        routeKey: "base:0x0555->ethereum:0x2260",
        amount: "25000",
      },
      reasons: ["token"],
      actions: [
        {
          type: "fund_token",
          chain: "base",
          ticker: "wBTC.OFT",
          shortfallDecimal: 0.0015,
        },
      ],
    },
  });

  assert.equal(summary.status, "blocked");
  assert.equal(summary.currentStageId, "tiny_live_canary_review");
  assert.equal(summary.primaryCandidate.candidateType, "strategy");
  assert.equal(summary.counts.refresh, 0);
  assert.equal(summary.counts.operator, 0);
  assert.equal(summary.counts.technical, 0);
  assert.equal(summary.counts.objective, 0);
  assert.equal(summary.counts.total, 0);
  assert.equal(summary.nextAction, null);
  assert.deepEqual(summary.observations.suppressedRouteBlockers, [
    "connected_refresh_required",
    "fund_and_approve_wallet",
    "blocked_insufficient_data",
    "guarded_blocked",
  ]);
  assert.equal(summary.observations.paybackMinimumProgress.remainingSats, 49_942);
});
