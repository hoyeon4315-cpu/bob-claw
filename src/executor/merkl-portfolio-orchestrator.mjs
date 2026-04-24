import { config } from "../config/env.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { runMerklPortfolioExit } from "./merkl-portfolio-exit.mjs";
import { runMerklPortfolioAllocator } from "./merkl-portfolio-allocator.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";

async function writeOrchestratorReport(report) {
  const path = `${config.dataDir}/merkl-portfolio-orchestrator-latest.json`;
  await writeTextIfChanged(path, `${safeJsonStringify(report, 2)}\n`);
}

function compactExitReport(report = {}) {
  return {
    status: report.status || null,
    blockedReason: report.blockedReason || null,
    positionsEvaluated: report.positions?.length ?? 0,
    exitsReady: report.exits?.filter?.((item) => item.status === "exit_ready")?.length ?? 0,
    exitsExecuted: report.executions?.length ?? 0,
    txHashes: (report.executions || [])
      .map((item) => item.execution?.signerResult?.broadcast?.txHash)
      .filter(Boolean),
  };
}

function compactAllocatorReport(report = {}) {
  return {
    status: report.status || null,
    blockedReason: report.blockedReason || null,
    entryQueueSize: report.plan?.entryQueue?.length ?? 0,
    deployments: (report.executions || []).map((item) => ({
      opportunityId: item.opportunityId,
      status: item.status,
      txHash: item.txHash,
    })),
  };
}

export async function runMerklPortfolioOrchestrator({
  execute = false,
  write = false,
  forceExit = false,
  queuePath,
  socketPath,
  timeoutMs,
  policy: policyInput = {},
  maxUsd = null,
  minEthereumNotionalUsd,
  allowInefficientEthereum = false,
} = {}) {
  const observedAt = new Date().toISOString();
  const results = {
    schemaVersion: 1,
    observedAt,
    mode: execute ? "execute" : "preview",
    exit: null,
    inventoryRefresh: null,
    allocator: null,
  };

  // Phase 1: Exit stale positions
  const exitReport = await runMerklPortfolioExit({
    execute,
    write: false,
    force: forceExit,
    queuePath,
    socketPath,
    timeoutMs,
    policy: policyInput,
  });
  results.exit = compactExitReport(exitReport);

  // Phase 2: Refresh inventory so allocator sees freed capital
  let inventoryRefresh = { status: "skipped", scannedCount: 0 };
  if (execute && results.exit.exitsExecuted > 0) {
    try {
      const scanResult = await scanTreasuryInventory({
        dataDir: config.dataDir,
        address: exitReport?.preflight?.senderAddress,
      });
      inventoryRefresh = {
        status: "ok",
        scannedCount: Array.isArray(scanResult) ? scanResult.length : 0,
      };
    } catch (error) {
      inventoryRefresh = {
        status: "error",
        error: error?.message || String(error),
      };
    }
  }
  results.inventoryRefresh = inventoryRefresh;

  // Phase 3: Allocate freed (and existing idle) capital into best opportunities
  const allocatorReport = await runMerklPortfolioAllocator({
    execute,
    write: false,
    queuePath,
    socketPath,
    timeoutMs,
    policy: policyInput,
    maxUsd,
    minEthereumNotionalUsd,
    allowInefficientEthereum,
  });
  results.allocator = compactAllocatorReport(allocatorReport);

  const overallStatus =
    results.exit.status === "blocked" && results.allocator.status === "blocked"
      ? "blocked"
      : results.allocator.status === "ok" || results.exit.status === "ok"
        ? "ok"
        : results.allocator.status || results.exit.status || "idle";

  const report = {
    ...results,
    status: overallStatus,
    blockedReason:
      overallStatus === "blocked"
        ? results.allocator.blockedReason || results.exit.blockedReason || "exit_and_allocator_blocked"
        : null,
  };

  if (write) await writeOrchestratorReport(report);

  return report;
}
