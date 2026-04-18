#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { writeDashboardStatus } from "../status/dashboard-status.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";
import {
  buildCanaryInputRefreshExactGasArgs,
  buildCanaryInputRefreshGasSnapshotArgs,
  buildCanaryInputRefreshScoringArgs,
  buildCanaryInputRefreshVerifyArgs,
  buildCanaryInputRefreshDexArgs,
  planCanaryInputRefresh,
  describeBlockedScoreRefreshSelection,
  planBlockedScoreRefresh,
  planDexEnvironmentRefresh,
  planDexGatewayCoverageRefresh,
  planDexPriceRefresh,
  planGasRefresh,
  planQuoteDecayRefresh,
} from "../watch/canary-readiness-watch.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    skipShadowCycle: flags.has("--skip-shadow-cycle"),
    skipCanaryInputRefresh: flags.has("--skip-canary-input-refresh"),
  };
}

function runNodeScript(script, args = []) {
  const result = spawnSync(process.execPath, [resolve(ROOT, script), ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const toleratedTargetedGasRefreshFailure =
    script === "src/cli/estimate-gateway-gas.mjs" &&
    result.status !== 0 &&
    args.some((item) => item.startsWith("--route-key=")) &&
    /(?:failed|skipped) reason=/.test(stdout);
  if (result.status !== 0 && !toleratedTargetedGasRefreshFailure) {
    const error = new Error(`Command failed: node ${script} ${args.join(" ")}`.trim());
    error.stdout = stdout;
    error.stderr = stderr;
    throw error;
  }
  return { stdout, stderr };
}

export function refreshCanaryInputsIfNeeded({ state, address, runScript = runNodeScript } = {}) {
  const canaryInputRefresh = planCanaryInputRefresh(state);
  if (!canaryInputRefresh.shouldRefresh) return { refreshed: false, refresh: canaryInputRefresh };

  if (canaryInputRefresh.inputKeys.includes("market")) {
    runScript("src/cli/price-snapshot.mjs");
  }
  if (canaryInputRefresh.inputKeys.includes("gateway_quote")) {
    runScript("src/cli/verify-gateway.mjs", buildCanaryInputRefreshVerifyArgs(canaryInputRefresh) || []);
  }
  if (canaryInputRefresh.inputKeys.includes("src_gas")) {
    runScript("src/cli/gas-snapshot.mjs", buildCanaryInputRefreshGasSnapshotArgs(canaryInputRefresh) || []);
  }
  if (canaryInputRefresh.inputKeys.includes("exact_gas")) {
    runScript("src/cli/estimate-gateway-gas.mjs", buildCanaryInputRefreshExactGasArgs(canaryInputRefresh, address) || []);
  }
  if (canaryInputRefresh.inputKeys.includes("dex_quote")) {
    runScript("src/cli/quote-dex.mjs", buildCanaryInputRefreshDexArgs(canaryInputRefresh) || []);
  }
  runScript("src/cli/score-gateway.mjs", buildCanaryInputRefreshScoringArgs(canaryInputRefresh));
  return { refreshed: true, refresh: canaryInputRefresh };
}

function watcherReasonLabel(kind, reason) {
  const labels = {
    canaryInputs: {
      stale_canary_route_inputs: "현재 canary route 입력이 오래되어 다시 측정 필요",
      missing_canary_route_inputs: "현재 canary route 입력 일부가 비어 있어 다시 측정 필요",
      canary_route_inputs_fresh: "현재 canary route 입력이 일단 최신 상태",
      no_active_canary_route: "현재 canary route가 없어 입력 재확인 대상이 없음",
      not_applicable: "지금은 canary route 입력 재확인이 필요하지 않음",
    },
    gasRefresh: {
      stale_src_gas_snapshot: "source 체인 gas가 오래되어 다시 확인 필요",
      exact_src_execution_gas_reverted: "exact gas가 리버트되어 route 자체가 막혀 있음",
      not_stale_src_gas_blocked: "지금은 gas freshness가 핵심 blocker가 아님",
      route_missing: "gas 재확인 대상 route가 없음",
      src_chain_not_supported: "source 체인이 gas snapshot 대상이 아님",
      not_applicable: "지금은 gas 재확인이 필요하지 않음",
    },
    dexRefresh: {
      missing_chain_price: "현재 canary 경로 체인 가격이 비어 있음",
      stale_chain_price: "현재 canary 경로 체인 가격이 오래됨",
      missing_gateway_chain_price: "quote 가능한 Gateway 체인 가격이 비어 있음",
      stale_gateway_chain_price: "quote 가능한 Gateway 체인 가격이 오래됨",
      chain_prices_fresh: "관측 중인 체인 가격이 모두 최신 상태",
      not_applicable: "지금은 DEX 가격 재확인이 필요하지 않음",
    },
    blockedScore: {
      newer_market_inputs: "새 가격 또는 quote 입력이 들어와 다시 계산 필요",
      score_inputs_unchanged: "점수에 반영할 새 입력 변화가 없음",
      score_missing: "현재 route 점수 스냅샷이 없음",
      not_net_edge_blocked: "순이익 기준 미달 block이 아님",
      not_applicable: "지금은 점수 재계산 조건이 아님",
    },
    quoteDecay: {
      missing_decay_observation: "decay 관측 샘플이 아직 없음",
      waiting_decay_window: "다음 decay 측정 창이 아직 열리지 않음",
      due_decay_window: "다음 decay 측정 창이 열려 재확인 가능",
      decay_windows_complete: "기본 decay 창 측정이 모두 채워짐",
      not_applicable: "지금은 decay 재확인이 필요하지 않음",
    },
    dexEnvironment: {
      stale_dex_environment: "DEX 실행환경이 오래되어 다시 quote 필요",
      thin_liquidity_dex_environment: "DEX 유동성이 얇아 다시 quote로 확인 필요",
      unstable_dex_environment: "DEX 실행가격 흔들림이 커서 다시 확인 필요",
      single_sample_dex_environment: "DEX 샘플 수가 부족해 다시 확인 필요",
      dex_environment_stable: "관측 중인 DEX 실행환경이 일단 안정적",
      unmeasured_environment: "아직 측정된 DEX 실행환경 route가 없음",
      not_applicable: "지금은 DEX 환경 재확인이 필요하지 않음",
    },
    gatewayCoverage: {
      missing_gateway_focus_quotes: "닫힌 루프 후보 route의 Gateway quote가 비어 있어 다시 probe 필요",
      gateway_focus_covered: "focus shortlist의 Gateway quote가 일단 채워져 있음",
      no_fully_measurable_routes: "아직 양쪽 DEX를 함께 볼 수 있는 route가 부족함",
      not_applicable: "지금은 Gateway coverage 재확인이 필요하지 않음",
    },
  };
  return labels[kind]?.[reason] || reason || null;
}

function routeLabelForScore(score) {
  return [
    `${score.srcChain}->${score.dstChain}`,
    `${score.srcAsset?.ticker || "?"}->${score.dstAsset?.ticker || "?"}`,
  ].join(" ");
}

function isBtcFamilyScore(score) {
  const families = [score?.srcAsset?.family, score?.dstAsset?.family];
  return families.every((family) => family === "btc" || family === "wrapped_btc");
}

function previewDexRefreshTargets(state, dexRefresh) {
  const scores = state?.scoreSnapshot?.scores || [];
  const selected = dexRefresh?.routeKey && dexRefresh?.amount
    ? scores.filter((score) => score.routeKey === dexRefresh.routeKey && String(score.amount) === String(dexRefresh.amount))
    : scores.filter((score) => dexRefresh?.chains?.includes(score.dstChain) && score?.dstAsset?.family === "wrapped_btc");
  return {
    targetRouteCount: selected.length,
    targetRoutes: selected.slice(0, 3).map(routeLabelForScore),
  };
}

function previewBlockedScoreTargets(state, blockedScore) {
  const scores = state?.scoreSnapshot?.scores || [];
  const selection = describeBlockedScoreRefreshSelection(blockedScore, state?.nextStep?.route || null);
  const selected = selection.scope === "touch_chains"
    ? scores.filter(
        (score) =>
          isBtcFamilyScore(score) && (selection.chains.includes(score.srcChain) || selection.chains.includes(score.dstChain)),
      )
    : scores.filter((score) => score.routeKey === blockedScore.routeKey && String(score.amount) === String(blockedScore.amount));
  return {
    scope: selection.scope,
    chains: selection.chains,
    targetRouteCount: selected.length,
    targetRoutes: selected.slice(0, 3).map(routeLabelForScore),
  };
}

function changedInputLabel(type) {
  const labels = {
    quote: "Gateway quote 변경",
    exact_gas: "exact gas 변경",
    dex_quote: "DEX quote 변경",
    src_gas_snapshot: "source 체인 gas 변경",
    bitcoin_fee: "BTC fee 변경",
    src_price: "source 가격 변경",
    dst_price: "destination 가격 변경",
    score_missing: "점수 스냅샷 없음",
  };
  return labels[type] || type;
}

function canaryInputLabel(type) {
  const labels = {
    gateway_quote: "Gateway quote",
    exact_gas: "exact gas",
    src_gas: "source gas",
    dex_quote: "DEX quote",
    bitcoin_fee: "BTC fee",
    market: "market snapshot",
  };
  return labels[type] || type;
}

function buildPublicWatchers(state) {
  const canaryInputs = planCanaryInputRefresh(state);
  const gasRefresh = planGasRefresh(state);
  const dexRefresh = planDexPriceRefresh(state);
  const blockedScore = planBlockedScoreRefresh(state);
  const quoteDecay = planQuoteDecayRefresh(state);
  const dexEnvironment = planDexEnvironmentRefresh(state);
  const gatewayCoverage = planDexGatewayCoverageRefresh(state);
  const dexTargets = previewDexRefreshTargets(state, dexRefresh);
  const blockedTargets = previewBlockedScoreTargets(state, blockedScore);
  return {
    canaryInputs: {
      shouldRefresh: canaryInputs.shouldRefresh,
      reason: canaryInputs.reason,
      reasonLabel: watcherReasonLabel("canaryInputs", canaryInputs.reason),
      routeLabel: canaryInputs.routeLabel || state?.nextStep?.route?.label || null,
      amount: canaryInputs.amount || null,
      inputKeys: canaryInputs.inputKeys || [],
      inputLabels: (canaryInputs.inputKeys || []).map(canaryInputLabel),
    },
    gasRefresh: {
      shouldRefresh: gasRefresh.shouldRefresh,
      reason: gasRefresh.reason,
      reasonLabel: watcherReasonLabel("gasRefresh", gasRefresh.reason),
      chains: gasRefresh.chains || [],
      chainCount: gasRefresh.chains?.length || 0,
      routeLabel: state?.nextStep?.route?.label || null,
      amount: gasRefresh.amount || null,
      targetRouteCount: gasRefresh.routeKey && gasRefresh.amount ? 1 : 0,
    },
    dexRefresh: {
      shouldRefresh: dexRefresh.shouldRefresh,
      reason: dexRefresh.reason,
      reasonLabel: watcherReasonLabel("dexRefresh", dexRefresh.reason),
      chains: dexRefresh.chains || [],
      chainCount: dexRefresh.chains?.length || 0,
      scope: dexRefresh.routeKey && dexRefresh.amount ? "route" : "gateway_chains",
      routeLabel: state?.nextStep?.route?.label || null,
      amount: dexRefresh.amount || null,
      targetRouteCount: dexTargets.targetRouteCount,
      targetRoutes: dexTargets.targetRoutes,
    },
    blockedScore: {
      shouldRefresh: blockedScore.shouldRefresh,
      reason: blockedScore.reason,
      changedInputs: blockedScore.changedInputs || [],
      changedInputLabels: (blockedScore.changedInputs || []).map(changedInputLabel),
      reasonLabel: watcherReasonLabel("blockedScore", blockedScore.reason),
      scope: blockedTargets.scope,
      chains: blockedTargets.chains,
      targetRouteCount: blockedTargets.targetRouteCount,
      targetRoutes: blockedTargets.targetRoutes,
      routeLabel: state?.nextStep?.route?.label || null,
      amount: blockedScore.amount || null,
    },
    quoteDecay: {
      shouldRefresh: quoteDecay.shouldRefresh,
      reason: quoteDecay.reason,
      reasonLabel: watcherReasonLabel("quoteDecay", quoteDecay.reason),
      pendingWindowSeconds: quoteDecay.pendingWindowSeconds || null,
      routeLabel: state?.nextStep?.route?.label || null,
      amount: quoteDecay.amount || null,
    },
    dexEnvironment: {
      shouldRefresh: dexEnvironment.shouldRefresh,
      reason: dexEnvironment.reason,
      reasonLabel: watcherReasonLabel("dexEnvironment", dexEnvironment.reason),
      routeLabel: dexEnvironment.routeKey || null,
      amount: dexEnvironment.amount || null,
      classification: dexEnvironment.classification || null,
      targetRouteCount: dexEnvironment.targetRouteCount || 0,
      targetRoutes: (dexEnvironment.targetRoutes || []).map((item) => `${item.routeKey} amount=${item.amount} (${item.classification})`),
    },
    gatewayCoverage: {
      shouldRefresh: gatewayCoverage.shouldRefresh,
      reason: gatewayCoverage.reason,
      reasonLabel: watcherReasonLabel("gatewayCoverage", gatewayCoverage.reason),
      routeLabel: gatewayCoverage.routeKey || null,
      classification: gatewayCoverage.classification || null,
      targetRouteCount: gatewayCoverage.targetRouteCount || 0,
      targetRoutes: (gatewayCoverage.targetRoutes || []).map((item) => `${item.routeKey} (${item.classification})`),
      touchChains: gatewayCoverage.touchChains || [],
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.skipShadowCycle) {
    runNodeScript("src/cli/run-shadow-cycle.mjs", ["--write"]);
  }

  let context = await buildCurrentDashboardContext({ dataDir: config.dataDir });
  let status = context.dashboardStatus;
  let watchState = context.state;
  watchState.dashboardStatus = status;

  if (!args.skipCanaryInputRefresh) {
    const refreshed = refreshCanaryInputsIfNeeded({
      state: watchState,
      address: watchState.address || null,
    });
    if (refreshed.refreshed) {
      context = await buildCurrentDashboardContext({ dataDir: config.dataDir, address: watchState.address || null });
      status = context.dashboardStatus;
      watchState = context.state;
    }
  }

  watchState.dashboardStatus = status;
  status.watchers = buildPublicWatchers(watchState);
  const output = await writeDashboardStatus(config.dataDir, status);
  const dashboardOutput = await writeDashboardStatus("./dashboard/public", status);

  console.log(`${output.changed ? "wrote" : "unchanged"}=${output.path}`);
  console.log(`${dashboardOutput.changed ? "dashboardWrote" : "dashboardUnchanged"}=${dashboardOutput.path}`);
  console.log(`severity=${status.overall.severity}`);
  console.log(`liveTrading=${status.overall.liveTrading}`);
  console.log(`shadowTrading=${status.overall.shadowTrading}`);
  console.log(`gatewayRoutes=${status.gateway.routeCount}`);
  console.log(`gatewayUpdateDetected=${status.gateway.updateDetected}`);
  console.log(`probeOk=${status.gateway.probeOk}/${status.gateway.probeTotal}`);
  console.log(`auditDecision=${status.audit.decision}`);
  if (status.executorRuntime) {
    console.log(
      `executorRuntime=${status.executorRuntime.runtimeStatus || "unknown"} watchdog=${status.executorRuntime.watchdog?.status || "unknown"} socket=${status.executorRuntime.signerSocketPresent ? "present" : "missing"} ageMs=${status.executorRuntime.watchdog?.ageMs ?? "n/a"}`,
    );
  }
  if (status.payback) {
    console.log(
      `paybackScheduler=${status.payback.scheduler?.status || "none"} reason=${status.payback.scheduler?.reason || "none"} next=${status.payback.scheduler?.nextAction || "none"} pendingSats=${status.payback.accumulatorPendingSats ?? 0} lastSettledSats=${status.payback.lastPaybackSettledSats ?? "n/a"}`,
    );
    console.log(
      `paybackGrossProfitSatsPeriod=${status.payback.grossProfitSatsPeriod ?? 0} paidBackSatsLifetime=${status.payback.paidBackSatsLifetime ?? 0}`,
    );
    if (status.payback.scheduler?.requiredEnvName) {
      console.log(`paybackRequiredEnv=${status.payback.scheduler.requiredEnvName}`);
    }
    if (status.payback.scheduler?.minimumPaybackProgress) {
      console.log(
        `paybackMinimumProgress=${status.payback.scheduler.minimumPaybackProgress.status || "none"} reason=${status.payback.scheduler.minimumPaybackProgress.reason || "none"} source=${status.payback.scheduler.minimumPaybackProgress.source || "none"} grossTargetSats=${status.payback.scheduler.minimumPaybackProgress.grossTargetBeforeCostsSats ?? "n/a"} minPaybackSats=${status.payback.scheduler.minimumPaybackProgress.minPaybackSats ?? "n/a"} remainingSats=${status.payback.scheduler.minimumPaybackProgress.satsToMinimumPayback ?? "n/a"} progressRatio=${status.payback.scheduler.minimumPaybackProgress.progressToMinimumRatio ?? "n/a"}`,
      );
    }
    if (status.payback.scheduler?.previewAfterDestination) {
      console.log(
        `paybackPreviewAfterDestination=${status.payback.scheduler.previewAfterDestination.status || "none"} reason=${status.payback.scheduler.previewAfterDestination.reason || "none"} grossTargetSats=${status.payback.scheduler.previewAfterDestination.grossTargetBeforeCostsSats ?? "n/a"} minPaybackSats=${status.payback.scheduler.previewAfterDestination.minPaybackSats ?? "n/a"} remainingSats=${status.payback.scheduler.previewAfterDestination.satsToMinimumPayback ?? "n/a"} progressRatio=${status.payback.scheduler.previewAfterDestination.progressToMinimumRatio ?? "n/a"}`,
      );
    }
  }
  console.log(`shadowCycleMode=${status.shadowCycle?.mode || "none"}`);
  console.log(`preliveStage=${status.prelive?.currentStage || "none"}`);
  console.log(`reviewPackageStatus=${status.prelive?.reviewPackage?.packageStatus || "none"}`);
  if (status.strategy?.strategySnapshot?.researchBoard) {
    console.log(
      `strategyResearch=candidates:${status.strategy.strategySnapshot.researchBoard.candidateCount ?? 0} top:${status.strategy.strategySnapshot.researchBoard.topCandidate?.id || "none"} newTop:${status.strategy.strategySnapshot.researchBoard.topNewCandidate?.id || "none"} newStatus:${status.strategy.strategySnapshot.researchBoard.topNewCandidate?.status || "none"} nextNew:${status.strategy.strategySnapshot.researchBoard.nextNewAction?.code || "none"}`,
    );
  }
  if (status.strategy?.strategySnapshot?.deterministicCandidates) {
    console.log(
      `deterministicCandidates=candidates:${status.strategy.strategySnapshot.deterministicCandidates.candidateCount ?? 0} readyForDryRun:${status.strategy.strategySnapshot.deterministicCandidates.readyForDryRunCount ?? 0} receiptBacked:${status.strategy.strategySnapshot.deterministicCandidates.receiptBackedCount ?? 0} top:${status.strategy.strategySnapshot.deterministicCandidates.topCandidate?.id || "none"} next:${status.strategy.strategySnapshot.deterministicCandidates.nextAction?.code || "none"}`,
    );
  }
  if (status.liveBaseline) {
    console.log(
      `liveBaseline=${status.liveBaseline.status} stage=${status.liveBaseline.currentStageId || "none"} refreshInputs=${status.liveBaseline.counts?.requiredRefreshCount ?? 0} operator=${status.liveBaseline.counts?.operator ?? 0} technical=${status.liveBaseline.counts?.technical ?? 0} objective=${status.liveBaseline.counts?.objective ?? 0}`,
    );
    console.log(
      `liveBaselineRefresh=${status.liveBaseline.blockers?.refresh?.map((item) => item.code).join(",") || "none"} next=${status.liveBaseline.nextAction?.category === "refresh" ? status.liveBaseline.nextAction.code : "none"}`,
    );
    console.log(
      `liveBaselineOperator=${status.liveBaseline.blockers?.operator?.map((item) => item.code).join(",") || "none"}`,
    );
    console.log(
      `liveBaselineTechnical=${status.liveBaseline.blockers?.technical?.map((item) => item.code).join(",") || "none"}`,
    );
    console.log(
      `liveBaselineObjective=${status.liveBaseline.blockers?.objective?.map((item) => item.code).join(",") || "none"}`,
    );
  }
  if (status.prelive?.connectedRefresh) {
    console.log(
      `connectedRefresh=${status.prelive.connectedRefresh.status || "none"} required=${status.prelive.connectedRefresh.requiredRefreshCount ?? 0} next=${status.prelive.connectedRefresh.nextActionCode || "none"}`,
    );
  }
  if (status.prelive?.connectedRefreshExecution) {
    console.log(
      `connectedRefreshExecution=runs:${status.prelive.connectedRefreshExecution.runCount ?? 0} preview:${status.prelive.connectedRefreshExecution.previewCount ?? 0} success:${status.prelive.connectedRefreshExecution.successCount ?? 0} latest:${status.prelive.connectedRefreshExecution.latestStatus || "none"}`,
    );
  }
  if (status.prelive?.currentRoutePrelivePass) {
    console.log(
      `currentRoutePrelivePass=runs:${status.prelive.currentRoutePrelivePass.runCount ?? 0} preview:${status.prelive.currentRoutePrelivePass.previewCount ?? 0} latest:${status.prelive.currentRoutePrelivePass.latestStatus || "none"} next:${status.prelive.currentRoutePrelivePass.nextAction?.code || "none"}`,
    );
  }
  if (status.prelive?.v1InfraDrills) {
    console.log(
      `v1InfraDrills=status:${status.prelive.v1InfraDrills.status || "none"} passed:${status.prelive.v1InfraDrills.passedCount ?? 0}/${status.prelive.v1InfraDrills.drillCount ?? 0} next:${status.prelive.v1InfraDrills.nextAction?.code || "none"}`,
    );
  }
  if (status.prelive?.exactRouteForkPackage) {
    console.log(
      `exactRouteFork=${status.prelive.exactRouteForkPackage.status || "none"} technical=${status.prelive.exactRouteForkPackage.technicalStatus || "n/a"} economic=${status.prelive.exactRouteForkPackage.economicStatus || "n/a"}`,
    );
  }
  if (status.prelive?.operationalJudgmentReview) {
    console.log(
      `operationalJudgment=${status.prelive.operationalJudgmentReview.status || "none"} issues=${status.prelive.operationalJudgmentReview.issueCount ?? 0}`,
    );
  }
  console.log(`blockers=${status.overall.blockers.join(",") || "none"}`);
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stderr || error.stdout || error.stack || error.message);
    process.exitCode = 1;
  });
}
