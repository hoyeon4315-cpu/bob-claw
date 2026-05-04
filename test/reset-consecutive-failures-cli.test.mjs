import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildConsecutiveFailureState } from "../src/executor/policy/consecutive-failures.mjs";
import { resetConsecutiveFailures } from "../src/cli/run-reset-consecutive-failures.mjs";

test("reset-consecutive-failures CLI appends an audit row and clears the active streak", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-reset-consecutive-failures-"));
  const auditPath = join(rootDir, "logs", "signer-audit.jsonl");

  try {
    await mkdir(join(rootDir, "logs"), { recursive: true });
    const rows = [
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "fail-1",
        intentHash: "fail-1",
        timestamp: "2026-05-04T00:00:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "fail-2",
        intentHash: "fail-2",
        timestamp: "2026-05-04T00:01:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
      {
        strategyId: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        intentId: "fail-3",
        intentHash: "fail-3",
        timestamp: "2026-05-04T00:02:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
    ];
    await writeFile(auditPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

    const result = await resetConsecutiveFailures({
      strategyId: "wrapped-btc-loop-base-moonwell",
      chain: "base",
      reason: "operator cleared failed broadcast streak",
      rootDir,
      now: "2026-05-04T00:03:00.000Z",
    });

    assert.equal(result.status, "ok");
    const auditLines = (await readFile(auditPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const lastRow = auditLines.at(-1);
    assert.equal(lastRow.intent.intentType, "operator_reset_consecutive_failures");
    assert.equal(lastRow.lifecycle.stage, "consecutive_failures_reset");
    assert.equal(lastRow.lifecycle.reason, "operator cleared failed broadcast streak");
    assert.equal(lastRow.chain, "base");

    const state = buildConsecutiveFailureState({
      strategyId: "wrapped-btc-loop-base-moonwell",
      chain: "base",
      auditRecords: auditLines,
    });
    assert.equal(state.consecutiveFailures, 0);
    assert.equal(state.lastResetAt, "2026-05-04T00:03:00.000Z");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
