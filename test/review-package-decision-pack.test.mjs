import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizePreliveReviewPackage } from "../src/prelive/review-package.mjs";

test("review package summary carries connected refresh, exact-route fork, and judgment review summaries", () => {
  const summary = summarizePreliveReviewPackage({
    generatedAt: "2026-04-14T06:00:00.000Z",
    packageStatus: "not_ready_for_manual_review",
    readyForManualReview: false,
    currentStage: "shadow_replay",
    reviewDecision: "NOT_READY_FOR_MANUAL_CANARY_REVIEW",
    reviewBlockers: ["shadow_replay_not_ready"],
    liveDecision: "LIVE_EXECUTION_BLOCKED",
    liveBlockers: ["audit_blocks_live"],
    tinyCanaryAdmission: {
      decision: "NO_GO",
      status: "blocked",
      blockers: ["shadow_replay_not_ready"],
    },
    remediationPlan: {
      overallStatus: "ready",
      runnerCommand: "npm run run:admission-remediation -- --execute --continue-on-failure --limit=3",
    },
    connectedRefreshPackage: {
      status: "network_refresh_required",
      summary: {
        requiredRefreshCount: 3,
        nextActionCode: "refresh_gateway_quote",
      },
    },
    connectedRefreshExecution: {
      runCount: 1,
      previewCount: 2,
      successCount: 1,
      failureCount: 0,
      latestStatus: "preview",
    },
    currentRoutePrelivePass: {
      runCount: 1,
      previewCount: 1,
      latestStatus: "connected_refresh_required",
      nextAction: {
        code: "execute_connected_refresh",
      },
    },
    exactRouteForkPackage: {
      status: "technical_ready_economic_blocked",
      plan: {
        planId: "plan-123",
      },
      readiness: {
        economicStatus: "blocked_no_net_edge",
      },
    },
    operationalJudgmentReview: {
      status: "guarded_blocked",
      issueCount: 4,
    },
  });

  assert.equal(summary.connectedRefreshStatus, "network_refresh_required");
  assert.equal(summary.connectedRefreshRequiredCount, 3);
  assert.equal(summary.connectedRefreshExecutionRunCount, 1);
  assert.equal(summary.connectedRefreshExecutionLatestStatus, "preview");
  assert.equal(summary.currentRoutePrelivePassRunCount, 1);
  assert.equal(summary.currentRoutePrelivePassLatestStatus, "connected_refresh_required");
  assert.equal(summary.currentRoutePrelivePassNextActionCode, "execute_connected_refresh");
  assert.equal(summary.exactRouteForkPackagePlanId, "plan-123");
  assert.equal(summary.exactRouteForkEconomicStatus, "blocked_no_net_edge");
  assert.equal(summary.operationalJudgmentStatus, "guarded_blocked");
  assert.equal(summary.operationalJudgmentIssueCount, 4);
});
