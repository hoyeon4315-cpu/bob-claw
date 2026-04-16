import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateApprovalHygiene } from "../src/executor/policy/approval-hygiene.mjs";

test("approval hygiene allows intents without approvals", () => {
  const result = evaluateApprovalHygiene({
    intent: {
      strategyId: "gateway-instant-swap-verification",
    },
  });

  assert.equal(result.decision, "ALLOW");
});

test("approval hygiene blocks unlimited approvals", () => {
  const result = evaluateApprovalHygiene({
    intent: {
      approval: {
        mode: "unlimited",
        token: "0xabc",
        spender: "0xdef",
        amount: "max",
      },
    },
  });

  assert.equal(result.decision, "BLOCK");
  assert.equal(result.blockers.includes("unlimited_approval_forbidden"), true);
});

test("approval hygiene requires expiry and revoke on idle for time-boxed approvals", () => {
  const result = evaluateApprovalHygiene({
    intent: {
      approval: {
        mode: "time_boxed",
        token: "0xabc",
        spender: "0xdef",
        expiresAt: "2026-04-16T03:00:00.000Z",
        revokeWhenIdle: false,
      },
    },
    now: "2026-04-16T00:00:00.000Z",
    maxApprovalTtlMs: 3_600_000,
  });

  assert.equal(result.blockers.includes("approval_ttl_exceeds_policy"), true);
  assert.equal(result.blockers.includes("approval_idle_revoke_missing"), true);
});

test("approval hygiene allows exact per-tx approvals", () => {
  const result = evaluateApprovalHygiene({
    intent: {
      approval: {
        mode: "per_tx",
        token: "0xabc",
        spender: "0xdef",
        amount: "1000",
      },
    },
  });

  assert.equal(result.decision, "ALLOW");
});
