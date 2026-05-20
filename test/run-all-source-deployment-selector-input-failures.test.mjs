import test from "node:test";
import assert from "node:assert/strict";

import { collectReportInputsSequentially } from "../src/cli/run-all-source-deployment-selector.mjs";

// Regression: when a required child report CLI fails with a child-process
// spawn error (EBADF observed in the field), collectReportInputsSequentially
// must not throw. It must continue past the failure, return null for the
// affected field, and record a typed diagnostic entry so the selector can
// still emit usable JSON with the partial bundle plus inputCollectionFailures.

function makeSpawnEbadf() {
  const error = new Error("spawn EBADF");
  error.name = "Error";
  error.code = "EBADF";
  error.syscall = "spawn";
  error.errno = -9;
  return error;
}

test("collectReportInputsSequentially records typed failure when a required child spawn fails", async () => {
  const result = await collectReportInputsSequentially({
    timeout: 5000,
    fetchPools: async () => [],
    runJson: async (script) => {
      if (script === "src/cli/plan-capital-manager-refill-jobs.mjs") throw makeSpawnEbadf();
      return { script };
    },
  });

  assert.equal(result.capitalManagerRefill, null);
  assert.ok(Array.isArray(result.inputCollectionFailures));
  const failure = result.inputCollectionFailures.find((entry) => entry.field === "capitalManagerRefill");
  assert.ok(failure, "expected failure entry for capitalManagerRefill");
  assert.equal(failure.required, true);
  assert.equal(failure.script, "src/cli/plan-capital-manager-refill-jobs.mjs");
  assert.equal(failure.error.code, "EBADF");
  assert.equal(failure.error.syscall, "spawn");
  assert.equal(failure.error.message, "spawn EBADF");
});

test("collectReportInputsSequentially keeps surviving required inputs intact after one spawn failure", async () => {
  const result = await collectReportInputsSequentially({
    timeout: 5000,
    fetchPools: async () => [{ pool: "alpha" }],
    runJson: async (script) => {
      if (script === "src/cli/report-allocator-core.mjs") throw makeSpawnEbadf();
      return { script };
    },
  });

  assert.deepEqual(result.defiLlamaPools, [{ pool: "alpha" }]);
  assert.equal(result.allocatorCore, null);
  assert.deepEqual(result.merklOpportunities, { script: "src/cli/report-merkl-opportunities.mjs" });
  assert.deepEqual(result.strategyCatalog, { script: "src/cli/report-strategy-catalog.mjs" });
  assert.equal(result.inputCollectionFailures.length, 1);
  assert.equal(result.inputCollectionFailures[0].field, "allocatorCore");
});

test("collectReportInputsSequentially records typed failure when an optional child spawn fails", async () => {
  const result = await collectReportInputsSequentially({
    timeout: 5000,
    fetchPools: async () => [],
    runJson: async (script) => {
      if (script === "src/cli/report-payback-status.mjs") throw makeSpawnEbadf();
      return { script };
    },
  });

  assert.equal(result.paybackStatus, null);
  const failure = result.inputCollectionFailures.find((entry) => entry.field === "paybackStatus");
  assert.ok(failure);
  assert.equal(failure.required, false);
  assert.equal(failure.error.code, "EBADF");
});

test("collectReportInputsSequentially returns empty inputCollectionFailures when all children succeed", async () => {
  const result = await collectReportInputsSequentially({
    timeout: 5000,
    fetchPools: async () => [],
    runJson: async (script) => ({ script }),
  });
  assert.deepEqual(result.inputCollectionFailures, []);
});
