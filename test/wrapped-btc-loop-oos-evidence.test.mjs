import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWrappedBtcLoopOosEvidence, summarizeWrappedBtcLoopOosEvidence } from "../src/strategy/wrapped-btc-loop-oos-evidence.mjs";

test("wrapped btc loop OOS evidence distinguishes simulated and signer-backed windows", () => {
  const report = buildWrappedBtcLoopOosEvidence({
    records: [
      { scenarioId: "healthy_baseline", executionMode: "simulated_dry_run", result: "passed" },
      { scenarioId: "health_factor_breach", executionMode: "simulated_dry_run", result: "passed" },
      { scenarioId: "buffer_breach", executionMode: "simulated_dry_run", result: "passed" },
      { scenarioId: "oracle_drift_pause", executionMode: "simulated_dry_run", result: "passed" },
    ],
    now: "2026-04-15T19:10:00.000Z",
  });
  assert.equal(report.summary.simulatedWindowReady, true);
  assert.equal(report.summary.signerWindowReady, false);
  assert.equal(report.summary.status, "simulated_window_ready");
  assert.equal(summarizeWrappedBtcLoopOosEvidence(report).signerBackedRunCount, 0);
});

test("wrapped btc loop OOS evidence clears once signer-backed passes exist", () => {
  const report = buildWrappedBtcLoopOosEvidence({
    records: [
      { scenarioId: "healthy_baseline", executionMode: "simulated_dry_run", result: "passed" },
      { scenarioId: "health_factor_breach", executionMode: "simulated_dry_run", result: "passed" },
      { scenarioId: "buffer_breach", executionMode: "simulated_dry_run", result: "passed" },
      { scenarioId: "oracle_drift_pause", executionMode: "simulated_dry_run", result: "passed" },
      { scenarioId: "healthy_baseline", executionMode: "signer_backed_receipt", result: "passed" },
      { scenarioId: "buffer_breach", executionMode: "signer_backed_receipt", result: "passed" },
    ],
    now: "2026-04-15T19:10:00.000Z",
  });
  assert.equal(report.summary.signerWindowReady, true);
  assert.equal(report.summary.status, "signer_backed_window_ready");
  assert.equal(summarizeWrappedBtcLoopOosEvidence(report).signerBackedRunCount, 2);
});
