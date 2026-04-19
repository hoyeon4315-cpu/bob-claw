import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAutoIngestCommand } from "../src/executor/ingestor/receipt-auto-ingest.mjs";

test("wrapped loop auto-ingest builds a fully populated receipt command", () => {
  const command = buildAutoIngestCommand({
    strategyId: "wrapped-btc-loop-base-moonwell",
    scenario: "healthy_baseline",
    entryTxHashes: ["0xentry1", "0xentry2"],
    unwindTxHashes: ["0xunwind1"],
    observedHealthFactorPath: [1.54, 1.42],
    observedLiquidationBufferPath: [18.1, 13.2],
    actualLoopFeesUsd: 0.12,
    actualUnwindCostUsd: 0.08,
    realizedNetCarryUsd: 0.03,
    notes: ["live batch"],
  });

  assert.equal(command.command, "npm");
  assert.equal(command.args.includes("--write"), true);
  assert.equal(command.args.includes("--scenario=healthy_baseline"), true);
  assert.equal(command.args.includes("--entry-tx-hashes=0xentry1,0xentry2"), true);
  assert.equal(command.args.includes("--unwind-tx-hashes=0xunwind1"), true);
  assert.equal(command.args.includes("--health-factor-path=1.54,1.42"), true);
  assert.equal(command.args.includes("--liquidation-buffer-path=18.1,13.2"), true);
  assert.equal(command.args.includes("--actual-loop-fees-usd=0.12"), true);
  assert.equal(command.args.includes("--actual-unwind-cost-usd=0.08"), true);
  assert.equal(command.args.includes("--realized-net-carry-usd=0.03"), true);
});

test("wrapped loop auto-ingest refuses incomplete receipt context", () => {
  const command = buildAutoIngestCommand({
    strategyId: "wrapped-btc-loop-base-moonwell",
    entryTxHashes: ["0xentry1"],
  });

  assert.equal(command, null);
});

test("wrapped loop auto-ingest builds a minimal receipt command when proof hydration can fill the rest", () => {
  const command = buildAutoIngestCommand({
    strategyId: "wrapped-btc-loop-base-moonwell",
    scenario: "healthy_baseline",
    entryTxHashes: ["0xentry1"],
    unwindTxHashes: ["0xunwind1"],
  });

  assert.equal(command.command, "npm");
  assert.equal(command.args.includes("--entry-tx-hashes=0xentry1"), true);
  assert.equal(command.args.includes("--unwind-tx-hashes=0xunwind1"), true);
  assert.equal(command.args.some((arg) => arg.startsWith("--health-factor-path=")), false);
  assert.equal(command.args.some((arg) => arg.startsWith("--liquidation-buffer-path=")), false);
});
