import assert from "node:assert/strict";
import { test } from "node:test";
import { checklistLinesForReviewState, executionStageLines } from "../src/cli/write-session-handoff.mjs";

test("write-session-handoff formatting prefers manual review only when review package is ready", () => {
  const lines = checklistLinesForReviewState(
    {
      completed: ["top canary route selected", "tx payload captured"],
      remaining: ["clear objective blocker", "advance canary beyond BLOCKED_ECONOMICALLY_UNJUSTIFIED_PREP"],
    },
    {
      readyForManualReview: true,
    },
  );

  assert.deepEqual(lines, [
    "- Completed so far: top canary route selected · tx payload captured",
    "- Remaining steps: manual canary review only",
  ]);
});

test("write-session-handoff formatting shows review-ready execution stage from the review package", () => {
  const lines = executionStageLines(
    {
      reviewStage: "NOT_READY_FOR_MANUAL_CANARY_REVIEW",
      reviewReasons: ["effective_system_net_pnl_not_positive", "insufficient_data"],
      liveStage: "LIVE_EXECUTION_ALLOWED",
      liveReasons: [],
      auditDecision: "LIVE_CANARY_REVIEW_POSSIBLE",
    },
    {
      readyForManualReview: true,
      liveDecision: "LIVE_EXECUTION_ALLOWED",
      executionRunbook: {
        nextActionCode: "manual_canary_review_only",
      },
    },
  );

  assert.deepEqual(lines, [
    "- Manual canary review: READY_FOR_MANUAL_CANARY_REVIEW (manual_canary_review_only)",
    "- Live execution: LIVE_EXECUTION_ALLOWED; audit=LIVE_CANARY_REVIEW_POSSIBLE",
  ]);
});
