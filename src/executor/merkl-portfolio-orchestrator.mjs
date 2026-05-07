import { config } from "../config/env.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { runMerklPortfolioExit } from "./merkl-portfolio-exit.mjs";
import { runMerklPortfolioAllocator } from "./merkl-portfolio-allocator.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../treasury/policy.mjs";

async function writeOrchestratorReport(report) {
  const path = `${config.dataDir}/merkl-portfolio-orchestrator-latest.json`;
  await writeTextIfChanged(path, `${safeJsonStringify(report, 2)}\n`);
}

function compactExitReport(report = {}) {
  const evaluations = report.evaluations || [];
  const executions = report.executions || [];
  return {
    status: report.status || null,
    blockedReason: report.blockedReason || null,
    positionsEvaluated: report.summary?.activePositionCount ?? evaluations.length,
    exitsReady: report.summary?.exitReadyCount ?? evaluations.filter((item) => item.status === "exit_ready").length,
    exitsExecuted: executions.length,
    txHashes: executions
      .map((item) => item.record?.txHash || item.execution?.signerResult?.broadcast?.txHash)
      .filter(Boolean),
  };
}

function compactAllocatorReport(report = {}) {
  const graduationCanaryRequests = report.plan?.graduationCanaryRequests || [];
  return {
    status: report.status || null,
    blockedReason: report.blockedReason || null,
    entryQueueSize: report.plan?.entryQueue?.length ?? 0,
    graduationCanaryRequestCount: report.plan?.summary?.graduationCanaryRequestCount
      ?? graduationCanaryRequests.length,
    graduationCanaryRequests,
    topGraduationCanaryRequest: graduationCanaryRequests[0] || null,
    idleCapitalReport: report.plan?.idleCapitalReport || null,
    deployments: (report.executions || []).map((item) => ({
      opportunityId: item.opportunityId,
      status: item.status,
      txHash: item.txHash || item.txHashes?.[0] || null,
      blockers: item.blockers || [],
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
  runExitImpl = runMerklPortfolioExit,
  runAllocatorImpl = runMerklPortfolioAllocator,
  scanInventoryImpl = scanTreasuryInventory,
  buildTreasuryPolicyImpl = buildDefaultTreasuryPolicy,
  validateTreasuryPolicyImpl = validateTreasuryPolicy,
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
  const exitReport = await runExitImpl({
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
      const treasuryPolicy = validateTreasuryPolicyImpl(buildTreasuryPolicyImpl());
      const scanResult = await scanInventoryImpl({
        policy: treasuryPolicy,
        address: exitReport?.preflight?.senderAddress,
      });
      inventoryRefresh = {
        status: "ok",
        scannedCount: Array.isArray(scanResult)
          ? scanResult.length
          : (scanResult?.native?.length ?? 0) + (scanResult?.tokens?.length ?? 0),
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
  const allocatorReport = await runAllocatorImpl({
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
