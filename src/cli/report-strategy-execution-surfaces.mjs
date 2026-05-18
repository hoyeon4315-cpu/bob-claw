#!/usr/bin/env node

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { readJsonl, readLatestJsonlRecord } from "../lib/jsonl-read.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readTriangleArtifacts } from "../flash/triangle-artifacts.mjs";
import { readSignerAuditLog } from "../executor/signer/audit-log.mjs";
import { buildStrategyExecutionSurfaces } from "../strategy/strategy-execution-surfaces.mjs";
import { buildSliceDryRunSummary } from "../strategy/slice-dryrun-summary-builder.mjs";
import { buildWrappedBtcLendingLoopScaffold } from "../strategy/wrapped-btc-lending-loop-slice.mjs";
import { buildAggressiveVelocityStatus } from "./report-aggressive-velocity-status.mjs";
import {
  resolveCapitalManagerPrices,
  resolveCapitalManagerTreasuryInventory,
} from "./plan-capital-manager-refill-jobs.mjs";
import { resolveShadowCycleContext } from "../session/shadow-cycle-context.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../treasury/policy.mjs";

const IS_MAIN = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

export function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    write: argv.includes("--write"),
  };
}

function compact(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

export function overlayAggressiveVelocityExecutionSurface(report, aggressiveStatus) {
  if (!report || !aggressiveStatus?.strategyId) return report;
  const strategies = (report.strategies || []).map((strategy) => {
    if (strategy.id !== aggressiveStatus.strategyId) return strategy;
    const blocker = aggressiveStatus.liveAdmissionBlockers?.[0] || aggressiveStatus.reason || strategy.fallbackReason;
    return {
      ...strategy,
      status: aggressiveStatus.status || strategy.status,
      reason: aggressiveStatus.reason || strategy.reason,
      currentLiveEligible: aggressiveStatus.currentLiveEligible === true,
      fallbackReason: aggressiveStatus.currentLiveEligible === true ? null : blocker,
      liveAdmissionBlockers:
        aggressiveStatus.currentLiveEligible === true
          ? []
          : compact(aggressiveStatus.liveAdmissionBlockers || [blocker]),
      adviceCode: aggressiveStatus.currentLiveEligible === true ? "live_candidate" : blocker,
      evidence: {
        ...(strategy.evidence || {}),
        candidateLadder: aggressiveStatus.candidateLadder || null,
        selectionDiagnostics: aggressiveStatus.selectionDiagnostics || null,
        rejectionEvidence: aggressiveStatus.rejectionEvidence || null,
      },
    };
  });

  return {
    ...report,
    summary: {
      ...(report.summary || {}),
      liveEligibleCount: strategies.filter((strategy) => strategy.currentLiveEligible === true).length,
    },
    strategies,
    strategyDiagnostics: {
      ...(report.strategyDiagnostics || {}),
      aggressiveVelocity: {
        strategyId: aggressiveStatus.strategyId,
        status: aggressiveStatus.status,
        reason: aggressiveStatus.reason,
        currentLiveEligible: aggressiveStatus.currentLiveEligible === true,
        liveAdmissionBlockers: aggressiveStatus.liveAdmissionBlockers || [],
        candidateLadder: aggressiveStatus.candidateLadder || null,
        selectedCount: aggressiveStatus.selectedCount ?? 0,
        totalQualified: aggressiveStatus.totalQualified ?? 0,
        selectionDiagnostics: aggressiveStatus.selectionDiagnostics || null,
        rejectionEvidence: aggressiveStatus.rejectionEvidence || null,
      },
    },
  };
}

export async function loadStrategyExecutionSurfaceInputs({
  dataDir = config.dataDir,
  readSignerAuditLogImpl = readSignerAuditLog,
  readTriangleArtifactsImpl = readTriangleArtifacts,
  resolveOperationalAddressImpl = resolveOperationalAddress,
  resolveShadowCycleContextImpl = resolveShadowCycleContext,
  resolveCapitalManagerPricesImpl = resolveCapitalManagerPrices,
  resolveCapitalManagerTreasuryInventoryImpl = resolveCapitalManagerTreasuryInventory,
  loadLiveInventory = true,
} = {}) {
  const [
    dashboardStatus,
    scoreSnapshot,
    triangleArtifacts,
    phase3StrategyValidation,
    wrappedBtcLendingLoopSlice,
    wrappedBtcLoopDryRunReceipts,
    latestTreasuryInventory,
    wrappedBtcLoopLiveProof,
    signerAuditRecords,
    merklCanaryQueue,
    merklCanaryAutopilotLatest,
    autonomousDiscoveryBoard,
    gatewayGoldReadiness,
    // YCE-003 wiring (Yield & Campaign Opportunity Engineer): load DefiLlama yield snapshot (produced by fetch-defillama-snapshot + evidenceClass from YCE-001) symmetric to gateway-gold-readiness-latest.json.
    // This ensures loadStrategyExecutionSurfaceInputs provides the receiptBoundPools + protocol_receipt_bound data to buildStrategyExecutionSurfaces (which calls buildStrategyCatalog internally).
    // The catalog already promotes defillama-yield-portfolio to shadow_ready when 604+ receipt_bound pools present; this wiring makes the snapshot data explicitly available in the surfaces report artifacts + hydratedDashboardStatus for current-dashboard-context.json consumers.
    defiLlamaYieldSnapshot,
  ] = await Promise.all([
    readJsonIfExists(join(dataDir, "dashboard-status.json")),
    readJsonIfExists(join(dataDir, "gateway-scores.json")),
    readTriangleArtifactsImpl(dataDir),
    readJsonIfExists(join(dataDir, "phase3-strategy-validation.json")),
    readJsonIfExists(join(dataDir, "wrapped-btc-lending-loop-slice.json")),
    readJsonl(dataDir, "wrapped-btc-loop-dry-runs"),
    readLatestJsonlRecord(dataDir, "treasury-inventory"),
    readJsonIfExists(join(dataDir, "wrapped-btc-loop-live-success-latest.json")),
    readSignerAuditLogImpl(),
    readJsonIfExists(join(dataDir, "merkl-canary-queue.json")),
    readJsonIfExists(join(dataDir, "merkl-canary-autopilot-latest.json")),
    readJsonIfExists(join(dataDir, "autonomous-discovery-board.json")),
    readJsonIfExists(join(dataDir, "gateway-gold-readiness-latest.json")),
    readJsonIfExists(join(dataDir, "snapshots", "defillama-yield-latest.json")),
  ]);

  const hydratedDashboardStatus = gatewayGoldReadiness
    ? {
        ...(dashboardStatus || { generatedAt: new Date().toISOString(), overall: { liveTrading: "BLOCKED" } }),
        gateway: {
          ...(dashboardStatus?.gateway || {}),
          goldRouteReadiness: gatewayGoldReadiness,
        },
        strategy: {
          ...(dashboardStatus?.strategy || {}),
          gatewayGoldReadiness,
        },
      }
    : dashboardStatus;

  // YCE-003 post-processing wiring continuation: hydrate defiLlamaYieldSnapshot into dashboardStatus.strategy for surfaces + downstream (current-dashboard-context.json).
  // This makes receiptBoundPools (604), evidenceClass=protocol_receipt_bound, and promotion status (shadow_ready) explicitly part of the hydrated state passed to buildStrategyExecutionSurfaces.
  // Catalog inside surfaces will use the snapshot (or this hydrated) to keep defillama-yield-portfolio in btcFamilies with status=shadow_ready, reason=receipt_bound_pools_via_snapshot_evidenceClass.
  let finalHydratedDashboardStatus = hydratedDashboardStatus;
  if (defiLlamaYieldSnapshot) {
    const snap = defiLlamaYieldSnapshot.snapshot || defiLlamaYieldSnapshot;
    finalHydratedDashboardStatus = {
      ...hydratedDashboardStatus,
      strategy: {
        ...(hydratedDashboardStatus?.strategy || {}),
        defiLlamaYieldSnapshot: {
          generatedAt: snap.generatedAt || snap.fetchedAt || null,
          totalPools: snap.totalPools || 0,
          receiptBoundPools: snap.receiptBoundPools || 0,
          evidenceClass: "protocol_receipt_bound",
          source: snap.source || "yields.llama.fi/pools",
        },
      },
    };
  }

  const hydratedWrappedBtcLendingLoopSlice = wrappedBtcLendingLoopSlice?.strategy?.id
    ? {
        ...wrappedBtcLendingLoopSlice,
        ...buildWrappedBtcLendingLoopScaffold({
          strategyConfig: wrappedBtcLendingLoopSlice.strategy || undefined,
          marketAssumptions: wrappedBtcLendingLoopSlice.marketAssumptions || undefined,
          dryRunReceipts: wrappedBtcLoopDryRunReceipts || [],
          signerAuditRecords,
        }),
        dryRunSummary: buildSliceDryRunSummary({
          strategyId: wrappedBtcLendingLoopSlice.strategy.id,
          signerAuditRecords,
          dryRunReceipts: wrappedBtcLoopDryRunReceipts || [],
          existingSummary: wrappedBtcLendingLoopSlice.dryRunSummary || {},
        }),
      }
    : wrappedBtcLendingLoopSlice;

  let liveTreasuryInventorySnapshot = null;
  if (loadLiveInventory) {
    const resolved = await resolveOperationalAddressImpl({
      dataDir,
      configuredAddress: config.estimateFrom,
    });
    const context = await resolveShadowCycleContextImpl({
      dataDir,
      explicitAddress: resolved.address,
      configuredAddress: config.estimateFrom,
    });
    const prices = await resolveCapitalManagerPricesImpl({ dataDir });
    const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
    const inventory = await resolveCapitalManagerTreasuryInventoryImpl({
      refreshInventory: true,
      context,
      policy,
      address: resolved.address,
      prices,
    });
    liveTreasuryInventorySnapshot = inventory.treasuryInventory || null;
  }

  return {
    dashboardStatus: finalHydratedDashboardStatus,
    state: {
      scoreSnapshot,
    },
    triangleArtifacts,
    artifacts: {
      phase3StrategyValidation,
      wrappedBtcLendingLoopSlice: hydratedWrappedBtcLendingLoopSlice,
      treasuryInventoryRecords: latestTreasuryInventory ? [latestTreasuryInventory] : [],
      wrappedBtcLoopLiveProof,
      signerAuditRecords,
      merklCanaryQueue,
      merklCanaryAutopilotLatest,
      autonomousDiscoveryBoard,
      liveTreasuryInventorySnapshot,
      // YCE-003: explicit defiLlama yield snapshot (with evidenceClass + receiptBound count) now available to surfaces consumers and current-dashboard-context.json
      defiLlamaYieldSnapshot,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { state, dashboardStatus, triangleArtifacts, artifacts } = await loadStrategyExecutionSurfaceInputs();
  const baseReport = buildStrategyExecutionSurfaces({
    dashboardStatus,
    state,
    triangleArtifacts,
    artifacts,
    now: new Date().toISOString(),
  });
  const aggressiveStatus = await buildAggressiveVelocityStatus();
  const report = overlayAggressiveVelocityExecutionSurface(baseReport, aggressiveStatus);

  if (args.write) {
    await writeTextIfChanged(
      join(config.dataDir, "strategy-execution-surfaces.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("BOB Claw Strategy Execution Surfaces");
  console.log(`generated: ${report.generatedAt}`);
  console.log(`liveTrading: ${report.policy.liveTrading}`);
  console.log(`runnable: ${report.summary.runnableCount}/${report.summary.strategyCount}`);
  console.log(`liveEligible: ${report.summary.liveEligibleCount}`);
  for (const strategy of report.strategies) {
    const scripts = strategy.selectedCommands
      .map((command) => command.script)
      .filter(Boolean)
      .join(",");
    console.log(
      [
        `- ${strategy.label}`,
        `bucket=${strategy.capabilityBucket}`,
        `mode=${strategy.selectedMode}`,
        `status=${strategy.status}`,
        scripts ? `scripts=${scripts}` : null,
        strategy.fallbackReason ? `reason=${strategy.fallbackReason}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
