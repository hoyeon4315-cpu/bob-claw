import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLeverageAutoUnwindRuntimeReport,
  parseArgs,
  resolveLeverageAutoUnwindRuntimePaths,
} from "../src/cli/report-leverage-auto-unwind-runtime.mjs";

test("parseArgs reads strategy and runtime overrides", () => {
  const args = parseArgs([
    "--write",
    "--json",
    "--strategy=recursive_wrapped_btc_lending_loop",
    "--health-factor=1.22",
    "--liquidation-buffer-pct=9.8",
    "--oracle-drift-pct=5.5",
    "--unwind-gas-usd=12.1",
  ]);

  assert.equal(args.write, true);
  assert.equal(args.json, true);
  assert.equal(args.strategy, "recursive_wrapped_btc_lending_loop");
  assert.equal(args.healthFactor, 1.22);
  assert.equal(args.liquidationBufferPct, 9.8);
  assert.equal(args.oracleDriftPct, 5.5);
  assert.equal(args.unwindGasUsd, 12.1);
});

test("resolveLeverageAutoUnwindRuntimePaths maps wrapped and recursive strategies correctly", () => {
  assert.deepEqual(resolveLeverageAutoUnwindRuntimePaths("wrapped-btc-loop-base-moonwell"), {
    scaffoldPath: "wrapped-btc-lending-loop-slice.json",
    latestPath: "wrapped-btc-loop-base-moonwell-auto-unwind-runtime-latest.json",
  });
  assert.deepEqual(resolveLeverageAutoUnwindRuntimePaths("recursive_wrapped_btc_lending_loop"), {
    scaffoldPath: "recursive_wrapped_btc_lending_loop-scaffold.json",
    latestPath: "recursive_wrapped_btc_lending_loop-auto-unwind-runtime-latest.json",
  });
});

test("buildLeverageAutoUnwindRuntimeReport loads scaffold and produces pause state when gas exceeds budget", async () => {
  const fixture = {
    strategy: {
      id: "recursive_wrapped_btc_lending_loop",
      label: "Recursive wrapped-BTC lending loop",
      chain: "base",
      protocol: "moonwell",
      isLeverage: true,
      healthFactorMin: 1.4,
      unwindTriggerHealthFactor: 1.3,
      liquidationBufferPct: 11,
    },
    marketAssumptions: {
      oracleDriftTriggerPct: 4,
      maxUnwindGasUsd: 10,
    },
    entryPlan: {
      projectedHealthFactor: 1.64,
      projectedLiquidationBufferPct: 14.4,
    },
    oracleSanity: {
      protocolDriftPct: 1.1,
    },
    unwindPlan: {
      actions: [{ step: "repay" }],
    },
    dryRunSummary: {
      dryRunReceiptRecorded: true,
      signerBackedRunCount: 1,
    },
    protocolAdapter: {
      id: "moonwell_recursive_loop",
    },
  };

  const { report } = await buildLeverageAutoUnwindRuntimeReport(
    {
      strategy: "recursive_wrapped_btc_lending_loop",
      unwindGasUsd: 11.2,
      healthFactor: null,
      liquidationBufferPct: null,
      oracleDriftPct: null,
    },
    {
      readJsonImpl: async () => fixture,
    },
  );

  assert.equal(report.runtime.status, "pause_new_entries");
  assert.equal(report.runtime.severity, "warning");
  assert.equal(report.watcherDecision.triggers.includes("unwind_gas_above_budget"), true);
  assert.equal(report.emergencyUnwindExecution.status, "standby");
});
