import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backfillConsecutiveFailuresClassifier } from "../src/cli/backfill-consecutive-failures-classifier.mjs";

test("backfill-consecutive-failures-classifier resets strategies with zero broadcastFailed", async () => {
  const fixtureAudit = [
    {
      schemaVersion: 1,
      timestamp: "2026-05-04T10:00:00.000Z",
      strategyId: "test-strategy-a",
      chain: "base",
      lifecycle: { stage: "rejected", blockers: ["max_consecutive_failures_reached"] },
      broadcast: null,
    },
    {
      schemaVersion: 1,
      timestamp: "2026-05-04T10:05:00.000Z",
      strategyId: "test-strategy-a",
      chain: "base",
      lifecycle: { stage: "rejected", blockers: ["max_consecutive_failures_reached"] },
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

test("backfill classifier replays exact broadcast failure counts and resets only paused zero-broadcast scopes", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-backfill-replay-counts-"));
  const auditPath = join(rootDir, "logs", "signer-audit.jsonl");

  try {
    await mkdir(join(rootDir, "logs"), { recursive: true });
    const rows = [
      {
        schemaVersion: 1,
        timestamp: "2026-05-04T10:00:00.000Z",
        strategyId: "paused-zero-broadcast",
        chain: "base",
        intentId: "policy-reject-1",
        lifecycle: { stage: "rejected", blockers: ["max_consecutive_failures_reached"] },
        policyVerdict: "rejected",
        broadcast: null,
      },
      {
        schemaVersion: 1,
        timestamp: "2026-05-04T10:01:00.000Z",
        strategyId: "quiet-policy-reject",
        chain: "base",
        intentId: "policy-reject-2",
        lifecycle: { stage: "rejected", blockers: ["strategy_per_chain_cap_exceeded"] },
        policyVerdict: "rejected",
        broadcast: null,
      },
      {
        schemaVersion: 1,
        timestamp: "2026-05-04T10:02:00.000Z",
        strategyId: "true-broadcast-fail",
        chain: "base",
        intentId: "fail-1",
        intentHash: "fail-1",
        lifecycle: { stage: "reverted" },
        policyVerdict: "errored",
        broadcast: { txHash: "0x1" },
      },
      {
        schemaVersion: 1,
        timestamp: "2026-05-04T10:03:00.000Z",
        strategyId: "true-broadcast-fail",
        chain: "base",
        intentId: "fail-2",
        intentHash: "fail-2",
        lifecycle: { stage: "reverted" },
        policyVerdict: "errored",
        broadcast: { txHash: "0x2" },
      },
    ];
    await writeFile(auditPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

    const preview = await backfillConsecutiveFailuresClassifier({
      auditPath,
      execute: false,
      rootDir,
    });

    assert.deepEqual(
      preview.replayedCounts.map((item) => ({
        strategyId: item.strategyId,
        chain: item.chain,
        consecutiveBroadcastFailures: item.consecutiveBroadcastFailures,
        broadcastFailedCount: item.broadcastFailedCount,
        hasMaxConsecutiveFailureBlocker: item.hasMaxConsecutiveFailureBlocker,
        needsReset: item.needsReset,
      })),
      [
        {
          strategyId: "paused-zero-broadcast",
          chain: "base",
          consecutiveBroadcastFailures: 0,
          broadcastFailedCount: 0,
          hasMaxConsecutiveFailureBlocker: true,
          needsReset: true,
        },
        {
          strategyId: "quiet-policy-reject",
          chain: "base",
          consecutiveBroadcastFailures: 0,
          broadcastFailedCount: 0,
          hasMaxConsecutiveFailureBlocker: false,
          needsReset: false,
        },
        {
          strategyId: "true-broadcast-fail",
          chain: "base",
          consecutiveBroadcastFailures: 2,
          broadcastFailedCount: 2,
          hasMaxConsecutiveFailureBlocker: false,
          needsReset: false,
        },
      ],
    );
    assert.deepEqual(preview.summary.map((item) => item.strategyId), ["paused-zero-broadcast"]);

    const executed = await backfillConsecutiveFailuresClassifier({
      auditPath,
      execute: true,
      rootDir,
      now: "2026-05-04T10:04:00.000Z",
    });
    assert.equal(executed.strategiesReset, 1);

    const auditLines = (await readFile(auditPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(auditLines.at(-1).strategyId, "paused-zero-broadcast");
    assert.equal(auditLines.at(-1).lifecycle.reason, "parcel-9 backfill from corrected classifier");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
