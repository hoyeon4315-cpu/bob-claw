import { test } from "node:test";
import { strict as assert } from "node:assert";
import { backfillConsecutiveFailuresClassifier } from "../src/cli/backfill-consecutive-failures-classifier.mjs";

test("backfill-consecutive-failures-classifier resets strategies with zero broadcastFailed", async () => {
  const fixtureAudit = [
    {
      schemaVersion: 1,
      timestamp: "2026-05-04T10:00:00.000Z",
      strategyId: "test-strategy-a",
      chain: "base",
      lifecycle: { stage: "rejected" },
      broadcast: null,
    },
    {
      schemaVersion: 1,
      timestamp: "2026-05-04T10:05:00.000Z",
      strategyId: "test-strategy-a",
      chain: "base",
      lifecycle: { stage: "rejected" },
      broadcast: null,
    },
    {
      schemaVersion: 1,
      timestamp: "2026-05-04T10:10:00.000Z",
      strategyId: "test-strategy-b",
      chain: "base",
      lifecycle: { stage: "reverted" },
      broadcast: { transactionHash: "0x..." },
    },
    {
      schemaVersion: 1,
      timestamp: "2026-05-04T10:15:00.000Z",
      strategyId: "test-strategy-b",
      chain: "base",
      lifecycle: { stage: "broadcasted" },
      broadcast: { transactionHash: "0x..." },
    },
  ];

  // Create a temporary test fixture
  const tmpDir = `/tmp/backfill-test-${Date.now()}`;
  const { exec } = await import("child_process").then((m) =>
    Promise.resolve({ exec: m.exec })
  );
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  await execAsync(`mkdir -p ${tmpDir}/logs`);
  const auditPath = `${tmpDir}/logs/signer-audit.jsonl`;

  // Write fixture
  const { writeFileSync } = await import("fs");
  writeFileSync(
    auditPath,
    fixtureAudit.map((r) => JSON.stringify(r)).join("\n")
  );

  const result = await backfillConsecutiveFailuresClassifier({
    auditPath,
    execute: false,
    rootDir: tmpDir,
  });

  assert.equal(result.status, "preview");
  assert.ok(
    result.strategiesNeedingReset > 0,
    "Should identify strategies with zero broadcast failures"
  );

  // Verify test-strategy-a is identified (policy rejected, no broadcasts)
  const testStrategyAFound = result.summary.some(
    (s) => s.strategyId === "test-strategy-a" && s.broadcastFailedCount === 0
  );
  assert.ok(testStrategyAFound, "test-strategy-a should be identified for reset");

  // Cleanup
  await execAsync(`rm -rf ${tmpDir}`);
});

test("backfill classifier idempotency", async () => {
  // After a reset is immediately applied, the strategy should not be flagged again
  // until new failures occur after the reset
  const fixtureAudit = [
    {
      schemaVersion: 1,
      timestamp: "2026-05-04T10:00:00.000Z",
      strategyId: "test-idempotent-a",
      chain: "base",
      lifecycle: { stage: "rejected" },
      broadcast: null,
    },
    {
      schemaVersion: 1,
      timestamp: "2026-05-04T10:05:00.000Z",
      intentType: "operator_reset_consecutive_failures",
      lifecycle: { stage: "consecutive_failures_reset" },
      strategyId: "test-idempotent-a",
      chain: "base",
    },
  ];

  const tmpDir = `/tmp/backfill-idempotent-${Date.now()}`;
  const { exec } = await import("child_process").then((m) =>
    Promise.resolve({ exec: m.exec })
  );
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  await execAsync(`mkdir -p ${tmpDir}/logs`);
  const auditPath = `${tmpDir}/logs/signer-audit.jsonl`;

  const { writeFileSync } = await import("fs");
  writeFileSync(
    auditPath,
    fixtureAudit.map((r) => JSON.stringify(r)).join("\n")
  );

  const result = await backfillConsecutiveFailuresClassifier({
    auditPath,
    execute: false,
    rootDir: tmpDir,
  });

  // If the latest record is a reset, the strategy should NOT be in the reset list
  const testIdempotentAFound = result.summary.some(
    (s) => s.strategyId === "test-idempotent-a"
  );
  assert.ok(!testIdempotentAFound, "Strategy with latest reset should not be flagged for reset");

  await execAsync(`rm -rf ${tmpDir}`);
});
