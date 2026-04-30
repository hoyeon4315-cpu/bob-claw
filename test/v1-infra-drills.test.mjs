import assert from "node:assert/strict";
import { test } from "node:test";
import { runV1InfraDrillSuite } from "../src/prelive/v1-infra-drills.mjs";

test("V1 infra drill suite passes all five repo-safe local drills", async () => {
  const report = await runV1InfraDrillSuite({
    now: "2026-04-17T00:20:00.000Z",
  });

  assert.equal(report.summary.status, "passed");
  assert.equal(report.summary.drillCount, 5);
  assert.equal(report.summary.passedCount, 5);
  assert.equal(report.summary.nextAction.code, "advance_v2_live_canaries");
  assert.deepEqual(
    report.drills.map((item) => item.id),
    [
      "kill_switch_file",
      "watchdog_heartbeat",
      "stale_quote_reject",
      "per_tx_cap_exceeded",
      "consecutive_failures",
    ],
  );
  const consecutive = report.drills.find((item) => item.id === "consecutive_failures");
  assert.equal(consecutive.status, "passed");
  assert.equal(consecutive.blockers.includes("max_consecutive_failures_reached"), true);
  assert.equal(consecutive.alert.sent, false);
  assert.equal(consecutive.alert.reason, "transaction_alerts_only");
});
