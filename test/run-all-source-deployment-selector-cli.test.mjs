import test from "node:test";
import assert from "node:assert/strict";

import {
  collectFreshInputBundleSequentially,
  collectReportInputsSequentially,
} from "../src/cli/run-all-source-deployment-selector.mjs";

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
      "src/cli/check-full-automation-readiness.mjs",
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
      if (script === "src/cli/check-full-automation-readiness.mjs") throw new Error("optional readiness failed");
      return { script };
    },
  });

  assert.deepEqual(result.defiLlamaPools, []);
  assert.equal(result.aggressiveStatus, null);
  assert.equal(result.merklUserRewards, null);
  assert.equal(result.paybackStatus, null);
  assert.equal(result.readiness, null);
});

test("collectFreshInputBundleSequentially keeps heavy source reads one at a time", async () => {
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const enter = async (name, value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    calls.push(name);
    await Promise.resolve();
    active -= 1;
    return value;
  };
  const result = await collectFreshInputBundleSequentially({
    timeout: 4321,
    collectCapitalAudit: async () =>
      enter("capitalAuditInputs", { signerAuditRecords: [{ id: "audit" }], protocolPositionMarks: [{ id: "mark" }] }),
    buildCapitalAudit: (inputs) => ({ summary: { inputCount: Object.keys(inputs).length } }),
    loadCapital: async () => enter("unifiedCapital", { unifiedNavUsd: 12 }),
    readKillSwitch: async () => enter("killStatus", { halted: false }),
    runJson: async (script, args, options) => enter(`runJson:${script}`, { script, args, timeout: options.timeout }),
    collectReports: async (options) => enter("reportInputs", { capitalManagerRefill: { timeout: options.timeout } }),
  });

  assert.equal(maxActive, 1);
  assert.deepEqual(calls, [
    "capitalAuditInputs",
    "runJson:src/cli/report-pendle-direct-canaries.mjs",
    "runJson:src/cli/dry-run-pendle-yt.mjs",
    "runJson:src/cli/report-pendle-yt-exit-from-position.mjs",
    "unifiedCapital",
    "killStatus",
    "reportInputs",
  ]);
  assert.deepEqual(result.signerAuditRecords, [{ id: "audit" }]);
  assert.deepEqual(result.protocolPositionMarks, [{ id: "mark" }]);
  assert.equal(result.capitalManagerRefill.timeout, 4321);
});
