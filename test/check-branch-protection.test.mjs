import test from "node:test";
import assert from "node:assert/strict";

import { runBranchProtectionCheck } from "../scripts/check-branch-protection.mjs";

test("passes when admin access exists and main has legacy protection", async () => {
  const result = await runBranchProtectionCheck({
    repo: "owner/repo",
    runGh: async (args) => {
      const path = args[1];
      if (path === "repos/owner/repo") return "true\n";
      if (path === "repos/owner/repo/rulesets") return "[]\n";
      if (path === "repos/owner/repo/branches") return "main\n";
      if (path === "repos/owner/repo/branches/main/protection") {
        return JSON.stringify({
          required_pull_request_reviews: {
            required_approving_review_count: 0,
          },
          required_status_checks: null,
          enforce_admins: { enabled: true },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
        });
      }
      throw new Error(`unexpected gh call: ${args.join(" ")}`);
    },
  });

  assert.equal(result.verdict, "pass");
  assert.equal(result.adminAccess, true);
  assert.equal(result.branches.main.protected, true);
  assert.equal(result.branches.dev.exists, false);
});

test("skips without admin access instead of pretending protection is configured", async () => {
  const result = await runBranchProtectionCheck({
    repo: "owner/repo",
    runGh: async (args) => {
      if (args[1] === "repos/owner/repo") return "false\n";
      throw new Error(`unexpected gh call: ${args.join(" ")}`);
    },
  });

  assert.equal(result.verdict, "skip");
  assert.equal(result.adminAccess, false);
  assert.match(result.reason, /admin/);
});
