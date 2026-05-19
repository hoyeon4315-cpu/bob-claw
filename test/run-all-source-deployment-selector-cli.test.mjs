import test from "node:test";
import assert from "node:assert/strict";

import { collectReportInputsSequentially } from "../src/cli/run-all-source-deployment-selector.mjs";

test("collectReportInputsSequentially runs child report commands one at a time", async () => {
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const result = await collectReportInputsSequentially({
    timeout: 1234,
    fetchPools: async () => [{ pool: "defillama-pool" }],
    runJson: async (script, args, options) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push({ script, args, timeout: options.timeout });
      await Promise.resolve();
      active -= 1;
      return { script, args };
    },
  });

  assert.equal(maxActive, 1);
  assert.equal(
    calls.every((call) => call.timeout === 1234),
    true,
  );
  assert.deepEqual(
    calls.map((call) => call.script),
    [
      "src/cli/report-merkl-opportunities.mjs",
      "src/cli/report-merkl-canary-queue.mjs",
      "src/cli/report-campaign-aware-opportunities.mjs",
      "src/cli/plan-capital-manager-refill-jobs.mjs",
      "src/cli/report-strategy-catalog.mjs",
      "src/cli/report-strategy-execution-surfaces.mjs",
      "src/cli/report-allocator-core.mjs",
      "src/cli/report-radar-board.mjs",
      "src/cli/report-aggressive-velocity-status.mjs",
      "src/cli/report-merkl-user-rewards.mjs",
      "src/cli/report-payback-status.mjs",
    ],
  );
  assert.deepEqual(result.defiLlamaPools, [{ pool: "defillama-pool" }]);
  assert.deepEqual(result.capitalManagerRefill, {
    script: "src/cli/plan-capital-manager-refill-jobs.mjs",
    args: ["--json"],
  });
  assert.deepEqual(result.paybackStatus, {
    script: "src/cli/report-payback-status.mjs",
    args: ["--json"],
  });
});

test("collectReportInputsSequentially preserves optional fallback behavior", async () => {
  const result = await collectReportInputsSequentially({
    timeout: 1234,
    fetchPools: async () => {
      throw new Error("defillama unavailable");
    },
    runJson: async (script) => {
      if (script === "src/cli/report-aggressive-velocity-status.mjs") throw new Error("optional aggressive failed");
      if (script === "src/cli/report-merkl-user-rewards.mjs") throw new Error("optional rewards failed");
      if (script === "src/cli/report-payback-status.mjs") throw new Error("optional payback failed");
      return { script };
    },
  });

  assert.deepEqual(result.defiLlamaPools, []);
  assert.equal(result.aggressiveStatus, null);
  assert.equal(result.merklUserRewards, null);
  assert.equal(result.paybackStatus, null);
});
