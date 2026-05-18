#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { AGGRESSIVE_VELOCITY_STRATEGY_CAPS } from "../config/aggressive-velocity/config.mjs";
import { buildAggressiveVelocityLiveState } from "../strategy/aggressive-velocity/live-execution.mjs";

const IS_MAIN = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
  };
}

export async function buildAggressiveVelocityStatus({ buildLiveStateImpl = buildAggressiveVelocityLiveState } = {}) {
  try {
    const liveState = await buildLiveStateImpl();
    const strategist = liveState.strategist;
    const candidateLadder = buildAggressiveVelocityCandidateLadder(strategist);
    const executorBound = true;
    const currentLiveEligible =
      AGGRESSIVE_VELOCITY_STRATEGY_CAPS.autoExecute === true && liveState.currentLiveEligible === true;
    const status = currentLiveEligible
      ? "live_candidate"
      : strategist.selectedCount > 0
        ? "shadow_ready"
        : "analysis_only";
    const reason = currentLiveEligible
      ? "high_yield_candidate_bound_to_registered_executor"
      : liveState.liveAdmissionBlockers?.[0] ||
        (strategist.selectedCount > 0 ? "high_yield_candidates_ranked" : "no_high_yield_candidates_selected");
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      strategyId: AGGRESSIVE_VELOCITY_STRATEGY_CAPS.strategyId,
      status,
      reason,
      liveCapable: true,
      currentLiveEligible,
      autoExecute: AGGRESSIVE_VELOCITY_STRATEGY_CAPS.autoExecute === true,
      executorBound,
      liveAdmissionBlockers: liveState.liveAdmissionBlockers,
      selectedCount: strategist.selectedCount,
      candidateLadder,
      bottleneckStage: candidateLadder.bottleneckStage,
      totalQualified: strategist.totalQualified,
      totalExpectedNetBtcProfit: strategist.totalExpectedNetBtcProfit,
      totalSimulatedRealizedNetBtc: strategist.totalSimulatedRealizedNetBtc,
      aggregateCaptureRate: strategist.aggregateCaptureRate,
      projectedNetUsd: liveState.projectedNetUsd,
      selectionDiagnostics: liveState.selectionDiagnostics,
      rejectionEvidence: liveState.rejectionEvidence,
      inventoryReadiness: liveState.inventoryReadiness || null,
      policyPreview: liveState.policyPreview || null,
      executableCandidate: liveState.executableCandidate
        ? {
            chain: liveState.executableCandidate.chain || null,
            protocol: liveState.executableCandidate.protocol || liveState.executableCandidate.protocolId || null,
            bindingKind: liveState.bindingKind,
            assetSymbol:
              liveState.executableCandidate.protocolBinding?.assetSymbol ||
              liveState.executableCandidate.assetSymbol ||
              null,
            assetPriceUsd: liveState.assetPriceUsd,
            expectedNetBtcProfit:
              liveState.executableCandidate.refinedNetBtcProfit ??
              liveState.executableCandidate.expectedNetBtcProfit ??
              null,
          }
        : null,
      topCandidates: (strategist.candidates || []).slice(0, 5).map((candidate) => ({
        chain: candidate.chain || null,
        protocol: candidate.protocol || null,
        expectedNetBtcProfit: candidate.expectedNetBtcProfit ?? null,
        strategistHighYieldSelectionScore: candidate.strategistHighYieldSelectionScore ?? null,
        realizationFeasibilityScore: candidate.realizationFeasibilityScore ?? null,
      })),
      note: "Aggressive strategist is bound to registered protocol builders when a candidate exposes executable protocol binding data.",
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      strategyId: AGGRESSIVE_VELOCITY_STRATEGY_CAPS.strategyId,
      status: "analysis_only",
      reason: "aggressive_status_scan_failed",
      liveCapable: true,
      currentLiveEligible: false,
      autoExecute: AGGRESSIVE_VELOCITY_STRATEGY_CAPS.autoExecute === true,
      executorBound: true,
      liveAdmissionBlockers: ["aggressive_status_scan_failed"],
      selectedCount: 0,
      candidateLadder: {
        rawCandidateCount: 0,
        credibleExitCount: 0,
        velocityCandidateCount: 0,
        selectedCount: 0,
        bottleneckStage: "raw",
      },
      bottleneckStage: "raw",
      totalQualified: 0,
      totalExpectedNetBtcProfit: 0,
      totalSimulatedRealizedNetBtc: 0,
      aggregateCaptureRate: 0,
      topCandidates: [],
      error: error?.message || String(error),
      note: "Aggressive strategist status could not be computed from current evidence inputs.",
    };
  }
}

export function buildAggressiveVelocityCandidateLadder(strategist = {}) {
  const selection = strategist?.selectionDiagnostics || {};
  const scan = strategist?.rejectionEvidence?.scan || strategist?.scanDiagnostics || {};
  const stageCounts = scan?.stageCounts || {};
  const rawCandidateCount = Number(
    scan.rawCount ?? stageCounts.rawCount ?? selection.scannerCandidateCount ?? strategist?.candidates?.length ?? 0,
  );
  const credibleExitCount = Number(
    stageCounts.passedCredibleExit ?? selection.safeExitCount ?? selection.shortlistedCount ?? 0,
  );
  const velocityCandidateCount = Number(
    stageCounts.passedVelocityScore ?? selection.realizationQualifiedCount ?? selection.qualifiedCount ?? 0,
  );
  const selectedCount = Number(
    strategist?.selectedCount ?? selection.finalSelectedCount ?? stageCounts.finalSelected ?? 0,
  );
  const safeRaw = Number.isFinite(rawCandidateCount) ? rawCandidateCount : 0;
  const safeCredibleExit = Number.isFinite(credibleExitCount) ? credibleExitCount : 0;
  const safeVelocity = Number.isFinite(velocityCandidateCount) ? velocityCandidateCount : 0;
  const safeSelected = Number.isFinite(selectedCount) ? selectedCount : 0;
  const bottleneckStage =
    safeRaw <= 0
      ? "raw"
      : safeCredibleExit <= 0
        ? "credible_exit"
        : safeVelocity <= 0
          ? "velocity"
          : safeSelected <= 0
            ? "selected"
            : null;
  return {
    rawCandidateCount: safeRaw,
    credibleExitCount: safeCredibleExit,
    velocityCandidateCount: safeVelocity,
    selectedCount: safeSelected,
    bottleneckStage,
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const payload = await buildAggressiveVelocityStatus();
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`strategyId=${payload.strategyId}`);
  console.log(`status=${payload.status}`);
  console.log(`reason=${payload.reason}`);
  console.log(`selectedCount=${payload.selectedCount}`);
  console.log(`currentLiveEligible=${payload.currentLiveEligible}`);
  console.log(`liveAdmissionBlockers=${payload.liveAdmissionBlockers.join(",")}`);
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
