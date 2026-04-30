import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scanConsecutiveFailures,
  healStrategyFailures,
} from "../../../src/executor/health/consecutive-failure-healer.mjs";

describe("consecutive-failure-healer", () => {
  it("returns zero failures for nonexistent strategy", async () => {
    const result = await scanConsecutiveFailures({
      strategyId: "nonexistent_strategy_xyz",
      auditLogPath: "/nonexistent/log",
    });

    assert.strictEqual(result.count, 0);
    assert.strictEqual(result.canAutoHeal, false);
    assert.strictEqual(result.lastFailureAt, null);
  });

  it("dryRun heal does not actually modify", async () => {
    const result = await healStrategyFailures({
      strategyId: "token-dex-experiment",
      dryRun: true,
      auditLogPath: "./logs/signer-audit.jsonl",
    });

    assert.strictEqual(result.healed, false);
    assert.ok(result.reason);
  });

  it("does not treat pure guard rejections as strategy failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "consecutive-failure-healer-"));
    const auditLogPath = join(root, "signer-audit.jsonl");
    const rows = [
      {
        strategyId: "recursive_wrapped_btc_lending_loop",
        intentId: "real-fail",
        timestamp: "2026-04-17T00:10:00.000Z",
        policyVerdict: "errored",
        lifecycle: { stage: "reverted" },
      },
      {
        strategyId: "recursive_wrapped_btc_lending_loop",
        intentId: "kill-switch-reject",
        timestamp: "2026-04-17T00:11:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected", blockers: ["kill_switch_present"] },
        broadcast: null,
      },
      {
        strategyId: "recursive_wrapped_btc_lending_loop",
        intentId: "self-reject",
        timestamp: "2026-04-17T00:12:00.000Z",
        policyVerdict: "rejected",
        lifecycle: { stage: "rejected", blockers: ["max_consecutive_failures_reached"] },
        broadcast: null,
      },
    ];
    await writeFile(auditLogPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);

    const result = await scanConsecutiveFailures({
      strategyId: "recursive_wrapped_btc_lending_loop",
      auditLogPath,
    });

    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.lastFailureAt, "2026-04-17T00:10:00.000Z");
  });
});
