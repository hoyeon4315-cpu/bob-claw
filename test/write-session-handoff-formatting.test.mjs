import assert from "node:assert/strict";
import { test } from "node:test";
import { checklistLinesForReviewState, executionStageLines } from "../src/cli/write-session-handoff.mjs";

test("write-session-handoff formatting prefers policy review only when review package is ready", () => {
  const lines = checklistLinesForReviewState(
    {
      completed: ["top canary route selected", "tx payload captured"],
      remaining: ["clear objective blocker", "advance canary beyond BLOCKED_ECONOMICALLY_UNJUSTIFIED_PREP"],
    },
    {
      readyForPolicyReview: true,
    },
  );

  assert.deepEqual(lines, [
    "- Completed so far: top canary route selected · tx payload captured",
    "- Remaining steps: policy canary review only",
  ]);
});

test("write-session-handoff formatting shows review-ready execution stage from the review package", () => {
  const lines = executionStageLines(
    {
      reviewStage: "NOT_READY_FOR_POLICY_CANARY_REVIEW",
      reviewReasons: ["effective_system_net_pnl_not_positive", "insufficient_data"],
      liveStage: "LIVE_EXECUTION_ALLOWED",
      liveReasons: [],
      auditDecision: "LIVE_CANARY_REVIEW_POSSIBLE",
    },
    {
      readyForPolicyReview: true,
      liveDecision: "LIVE_EXECUTION_ALLOWED",
      executionRunbook: {
        nextActionCode: "policy_canary_review_only",
      },
    },
  );

  assert.deepEqual(lines, [
    "- Policy canary review: READY_FOR_POLICY_CANARY_REVIEW (policy_canary_review_only)",
    "- Live execution: LIVE_EXECUTION_ALLOWED; audit=LIVE_CANARY_REVIEW_POSSIBLE",
  ]);
});
