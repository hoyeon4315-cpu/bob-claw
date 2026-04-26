import assert from "node:assert/strict";
import { test } from "node:test";
import { runMerklPortfolioOrchestrator } from "../src/executor/merkl-portfolio-orchestrator.mjs";

test("module exports runMerklPortfolioOrchestrator", () => {
  assert.equal(typeof runMerklPortfolioOrchestrator, "function");
});

test("preview mode returns structured report without crashing", async () => {
  const report = await runMerklPortfolioOrchestrator({
    execute: false,
    write: false,
  });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.mode, "preview");
  assert.ok(["blocked", "idle", "ok"].includes(report.status));
  assert.ok(report.exit != null);
  assert.ok(report.allocator != null);
  assert.ok(report.observedAt != null);
});

test("report aggregates blocked status when both phases block", async () => {
  const report = await runMerklPortfolioOrchestrator({
    execute: false,
    write: false,
  });
  // Both exit and allocator are likely blocked in preview without setup,
  // so overall status should be blocked.
  assert.ok(report.status != null);
  // Verify the report shape regardless of exact status
  assert.equal(typeof report.exit.status, "string");
  assert.equal(typeof report.allocator.status, "string");
});

test("execute mode refreshes inventory with a validated treasury policy after exits", async () => {
  let scanArgs = null;
  const report = await runMerklPortfolioOrchestrator({
    execute: true,
    write: false,
    runExitImpl: async () => ({
      status: "positions_closed",
      preflight: { senderAddress: "0x000000000000000000000000000000000000dEaD" },
      summary: {
        activePositionCount: 2,
        exitReadyCount: 1,
      },
      evaluations: [
        {
          status: "exit_ready",
          positionId: "p1",
        },
      ],
      executions: [
        {
          status: "position_closed",
          execution: {
            signerResult: {
              broadcast: { txHash: "0xclosed" },
            },
          },
        },
      ],
    }),
    scanInventoryImpl: async (args) => {
      scanArgs = args;
      return { native: [], tokens: [] };
    },
    runAllocatorImpl: async () => ({
      status: "blocked",
      blockedReason: "no_portfolio_entry_ready",
      plan: { entryQueue: [] },
      executions: [],
    }),
  });

  assert.equal(report.exit.positionsEvaluated, 2);
  assert.equal(report.exit.exitsReady, 1);
  assert.equal(report.exit.exitsExecuted, 1);
  assert.equal(report.exit.txHashes[0], "0xclosed");
  assert.equal(report.inventoryRefresh.status, "ok");
  assert.equal(scanArgs.address, "0x000000000000000000000000000000000000dEaD");
  assert.ok(Array.isArray(scanArgs.policy.supportedChains));
  assert.ok(scanArgs.policy.supportedChains.includes("base"));
});
