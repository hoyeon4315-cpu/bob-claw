#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { loadCanaryState } from "../estimator/load-canary-state.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildCanaryInputSummary } from "../status/canary-inputs.mjs";
import { buildDashboardStatus, writeDashboardStatus } from "../status/dashboard-status.mjs";
import {
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

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    skipShadowCycle: flags.has("--skip-shadow-cycle"),
  };
}

function runNodeScript(script, args = []) {
  const result = spawnSync(process.execPath, [resolve(ROOT, script), ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const error = new Error(`Command failed: node ${script} ${args.join(" ")}`.trim());
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
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

  const [
    routesRecords,
    quotes,
    failures,
    gasSnapshots,
    gasFailures,
    priceSnapshots,
    updateSnapshots,
    updateAlerts,
    scoreSnapshot,
    dexQuotes,
    dexFailures,
    bitcoinFeeSnapshots,
    gatewayGasEstimates,
    gatewayGasEstimateFailures,
    estimatorWalletReadiness,
    estimatorWalletReadinessFailures,
    shadowObservations,
    shadowCycle,
    advanceCanary,
  ] = await Promise.all([
    readJsonl(config.dataDir, "gateway-routes"),
    readJsonl(config.dataDir, "gateway-quotes"),
    readJsonl(config.dataDir, "gateway-quote-failures"),
    readJsonl(config.dataDir, "gas-snapshots"),
    readJsonl(config.dataDir, "gas-snapshot-failures"),
    readJsonl(config.dataDir, "market-price-snapshots"),
    readJsonl(config.dataDir, "gateway-update-snapshots"),
    readJsonl(config.dataDir, "gateway-update-alerts"),
    readJsonIfExists(join(config.dataDir, "gateway-scores.json")),
    readJsonl(config.dataDir, "dex-quotes"),
    readJsonl(config.dataDir, "dex-quote-failures"),
    readJsonl(config.dataDir, "bitcoin-fee-snapshots"),
    readJsonl(config.dataDir, "gateway-gas-estimates"),
    readJsonl(config.dataDir, "gateway-gas-estimate-failures"),
    readJsonl(config.dataDir, "estimator-wallet-readiness"),
    readJsonl(config.dataDir, "estimator-wallet-readiness-failures"),
    readJsonl(config.dataDir, "gateway-shadow-observations"),
    readJsonIfExists(join(config.dataDir, "shadow-cycle-latest.json")),
    readJsonIfExists(join(config.dataDir, "advance-canary-latest.json")),
  ]);

  const status = buildDashboardStatus({
    routesRecords,
    quotes,
    failures,
    gasSnapshots,
    gasFailures,
    priceSnapshots,
    updateSnapshots,
    updateAlerts,
    scoreSnapshot,
    dexQuotes,
    dexFailures,
    bitcoinFeeSnapshots,
    gatewayGasEstimates,
    gatewayGasEstimateFailures,
    estimatorWalletReadiness,
    estimatorWalletReadinessFailures,
    shadowObservations,
    shadowCycle,
    advanceCanary,
  });
  const resolved = await resolveOperationalAddress({ dataDir: config.dataDir });
  const watchState = await loadCanaryState({ address: resolved.address, dataDir: config.dataDir });
  watchState.dashboardStatus = status;
  status.canaryInputs = buildCanaryInputSummary(watchState, { now: status.generatedAt });
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
  console.log(`shadowCycleMode=${status.shadowCycle?.mode || "none"}`);
  console.log(`blockers=${status.overall.blockers.join(",") || "none"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
