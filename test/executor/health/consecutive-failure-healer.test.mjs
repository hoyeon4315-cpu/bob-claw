import { describe, it } from "node:test";
import assert from "node:assert";
import {
  scanConsecutiveFailures,
  healStrategyFailures,
} from "../../src/executor/health/consecutive-failure-healer.mjs";

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
});
