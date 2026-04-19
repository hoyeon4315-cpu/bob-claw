import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOperationalJudgmentReview, summarizeOperationalJudgmentReview } from "../src/prelive/operational-judgment-review.mjs";

test("operational judgment review surfaces stale-input and false-confidence risks", () => {
  const report = buildOperationalJudgmentReview({
    dashboardStatus: {
      overall: { liveTrading: "BLOCKED" },
    },
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: null },
      summary: { planningBudgetUsd: null },
    },
    reviewPackage: {
      manualReviewCandidate: {
        routeKey: "bob:0x0555->base:0x0555",
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        amount: "10000",
        tradeReadiness: "reject_no_net_edge",
      },
      measuredLeaderReview: {
        routeKey: "bitcoin:0x0->base:0x0",
        routeLabel: "bitcoin->base BTC->ETH",
        amount: "200000",
        tradeReadiness: "insufficient_data",
        command: 'npm run verify:gateway -- --route-key="bitcoin:0x0->base:0x0" --amounts="200000"',
      },
    },
    executionRunbook: {
      currentRoute: {
        routeKey: "bob:0x0555->base:0x0555",
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        amount: "10000",
        tradeReadiness: "reject_no_net_edge",
      },
      currentStageId: "shadow_replay",
      summary: {
        readyForManualReview: false,
        nextStageId: "shadow_replay",
      },
    },
    preliveValidation: {
      nextAction: {
        code: "refresh_gateway_quote",
        command: 'npm run verify:gateway -- --route-key="bob:0x0555->base:0x0555" --amounts="10000"',
      },
    },
    connectedRefreshPackage: {
      summary: {
        requiredRefreshCount: 2,
        nextActionCommand: 'npm run verify:gateway -- --route-key="bob:0x0555->base:0x0555" --amounts="10000"',
      },
    },
    exactRouteForkPackage: {
      plan: { planId: "plan-123" },
      commands: {
        refreshInputs: 'npm run verify:gateway -- --route-key="bob:0x0555->base:0x0555" --amounts="10000" && npm run gas:snapshot',
      },
      readiness: {
        technicalStatus: "submit_ready",
        economicStatus: "blocked_no_net_edge",
      },
    },
  });

  assert.equal(report.status, "guarded_blocked");
  assert.equal(report.highSeverityCount, 3);
  assert.equal(report.issueCount, 4);
  assert.equal(report.issues.some((entry) => entry.code === "stale_inputs_can_distort_route_scoring"), true);
  assert.equal(report.issues.some((entry) => entry.code === "technical_ready_but_economic_blocked"), true);
  assert.equal(report.issues.some((entry) => entry.code === "measured_leader_differs_from_current_canary"), true);

  const summary = summarizeOperationalJudgmentReview(report);
  assert.equal(summary.status, "guarded_blocked");
  assert.equal(summary.issueCount, 4);
  assert.equal(summary.nextActionCode, "stale_inputs_can_distort_route_scoring");
});

test("operational judgment review falls back to objective discovery divergence when no measured leader exists", () => {
  const report = buildOperationalJudgmentReview({
    dashboardStatus: {
      overall: { liveTrading: "BLOCKED" },
      shadowCycle: {
        objectivePlans: {
          discovery: {
            routeKey: "bitcoin:0x0->base:0x0",
            label: "bitcoin->base BTC->ETH",
            amount: "200000",
            status: "candidate_for_validation",
            command: 'npm run verify:gateway -- --route-key="bitcoin:0x0->base:0x0" --amounts="200000"',
          },
        },
      },
    },
    strategySnapshot: {
      currentSystem: { activeBudgetUsd: null },
      summary: { planningBudgetUsd: null },
    },
    reviewPackage: {
      manualReviewCandidate: {
        routeKey: "bob:0x0555->base:0x0555",
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        amount: "10000",
      },
    },
    executionRunbook: {
      currentRoute: {
        routeKey: "bob:0x0555->base:0x0555",
        routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
        amount: "10000",
      },
      currentStageId: "shadow_replay",
      summary: {
        readyForManualReview: false,
        nextStageId: "shadow_replay",
      },
    },
    connectedRefreshPackage: {
      summary: {
        requiredRefreshCount: 1,
        nextActionCommand: 'npm run verify:gateway -- --route-key="bob:0x0555->base:0x0555" --amounts="10000"',
      },
    },
    exactRouteForkPackage: {
      plan: { planId: "plan-123" },
      commands: {
        refreshInputs: 'npm run verify:gateway -- --route-key="bob:0x0555->base:0x0555" --amounts="10000"',
      },
      readiness: {
        technicalStatus: "submit_ready",
        economicStatus: "blocked_no_net_edge",
      },
    },
  });

  assert.equal(report.comparisonRoute?.source, "objective_discovery");
  assert.equal(report.issues.some((entry) => entry.code === "objective_route_differs_from_current_canary"), true);
});

test("operational judgment review suppresses route-only issues when a strategy candidate is primary", () => {
  const report = buildOperationalJudgmentReview({
    dashboardStatus: {
      overall: { liveTrading: "BLOCKED" },
    },
    reviewPackage: {
      primaryLiveCandidate: {
        candidateType: "strategy",
        candidateId: "wrapped-btc-loop-base-moonwell",
        candidateLabel: "Wrapped BTC lending loop (Base / Moonwell)",
      },
      manualReviewCandidate: {
        candidateType: "strategy",
        candidateId: "wrapped-btc-loop-base-moonwell",
        candidateLabel: "Wrapped BTC lending loop (Base / Moonwell)",
      },
      measuredLeaderReview: {
        routeKey: "bitcoin:0x0->base:0x0",
        routeLabel: "bitcoin->base BTC->ETH",
        amount: "200000",
      },
    },
    executionRunbook: {
      currentStageId: "tiny_live_canary_review",
      summary: {
        readyForManualReview: true,
        nextStageId: "manual_canary_review",
      },
    },
    connectedRefreshPackage: {
      summary: {
        requiredRefreshCount: 2,
        nextActionCommand: 'npm run verify:gateway -- --route-key="bob:0x0555->base:0x0555" --amounts="10000"',
      },
    },
    exactRouteForkPackage: {
      plan: { planId: "plan-123" },
      commands: {
        refreshInputs: 'npm run verify:gateway -- --route-key="bob:0x0555->base:0x0555" --amounts="10000" && npm run gas:snapshot',
      },
      readiness: {
        technicalStatus: "submit_ready",
        economicStatus: "blocked_no_net_edge",
      },
    },
  });

  assert.equal(report.status, "aligned_for_manual_review");
  assert.equal(report.issueCount, 0);
  assert.equal(report.nextAction, null);
});
