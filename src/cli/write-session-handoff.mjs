#!/usr/bin/env node

import { join } from "node:path";
import { classifyGatewayAssetUniverse } from "../assets/tokens.mjs";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { loadCanaryState, readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { buildYieldShadowBook, summarizeYieldShadowBook } from "../ledger/yield-shadow-book.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildAdmissionRemediationPlan } from "../prelive/admission-remediation.mjs";
import { buildConnectedRefreshPackage, summarizeConnectedRefreshPackage } from "../prelive/connected-refresh-package.mjs";
import { buildConnectedRefreshExecutionSummary } from "../prelive/connected-refresh-runner.mjs";
import { buildCurrentRoutePrelivePassSummary } from "../prelive/current-route-prelive-pass.mjs";
import { buildExecutionRunbook, summarizeExecutionRunbook } from "../prelive/execution-runbook.mjs";
import { buildPreliveEvidenceCampaign } from "../prelive/evidence-campaign.mjs";
import { buildExactRouteForkPackage, summarizeExactRouteForkPackage } from "../prelive/exact-route-fork-package.mjs";
import { buildOperationalJudgmentReview, summarizeOperationalJudgmentReview } from "../prelive/operational-judgment-review.mjs";
import { buildPreliveValidationReport, summarizePreliveValidationReport } from "../prelive/prelive-validation.mjs";
import { buildPreliveReadinessSummary } from "../prelive/readiness.mjs";
import { buildPreliveReviewPackage } from "../prelive/review-package.mjs";
import { summarizeV1InfraDrills } from "../prelive/v1-infra-drills.mjs";
import { buildPaybackDashboardSlice } from "../executor/payback/dashboard.mjs";
import { readTriangleArtifacts } from "../flash/triangle-artifacts.mjs";
import { buildCanaryInputSummary, buildCanaryStageChecklist, buildExecutionStageSummary } from "../status/canary-inputs.mjs";
import { buildLiveBaselineSummary } from "../status/live-baseline.mjs";
import { buildAllocatorCore } from "../strategy/allocator-core.mjs";
import { buildBtcProxySpreadSummary } from "../strategy/btc-proxy-spreads.mjs";
import { buildCrossAssetArbitrageSummary } from "../strategy/cross-asset-arbitrage.mjs";
import { buildDexEnvironmentSummary } from "../strategy/dex-environment.mjs";
import { buildDexRouteFocusSummary } from "../strategy/dex-route-focus.mjs";
import { buildDexGatewayArbitrageSummary } from "../strategy/dex-gateway-arbitrage.mjs";
import { buildDexRouteUniverseSummary } from "../strategy/dex-route-universe.mjs";
import { buildEdgeViabilitySummary, buildEdgeViabilityVerdict } from "../strategy/edge-viability.mjs";
import { buildEdgeResearchSummary } from "../strategy/edge-research.mjs";
import { buildEthereumRouteAnalysis } from "../strategy/ethereum-route-analysis.mjs";
import { buildNoEdgePersistenceSummary } from "../strategy/no-edge-persistence.mjs";
import { buildObjectivePlans } from "../strategy/objective-plans.mjs";
import { summarizePhase3StrategyValidation } from "../strategy/phase3-strategy-validation.mjs";
import { buildEthProfitabilitySummary, buildProfitabilitySummary } from "../strategy/profitability-summary.mjs";
import { buildStrategyPivotPlan, summarizeStrategyPivotPlan } from "../strategy/pivot-plan.mjs";
import { buildProxySpreadCoveragePlan, summarizeProxySpreadCoveragePlan } from "../strategy/proxy-spread-coverage-plan.mjs";
import { buildWrappedBtcLoopReceiptGuide } from "../strategy/wrapped-btc-lending-loop-dry-run.mjs";
import { buildStrategySnapshot, summarizeStrategySnapshot } from "../strategy/strategy-snapshot.mjs";
import { buildPivotDecisionSummary, buildRouteEconomicsAudit } from "../strategy/route-economics-audit.mjs";
import { buildStrategyTracksSummary } from "../strategy/strategy-tracks.mjs";
import { buildStrategyRefreshPlans } from "../strategy/strategy-refresh-plans.mjs";
import { buildFormulaAudit } from "../research/formula-audit.mjs";
import { summarizeShadowCandidateEvidence } from "../session/shadow-evidence.mjs";
import { shadowActionForCandidate } from "../session/shadow-cycle.mjs";
import {
  planCanaryInputRefresh,
  describeBlockedScoreRefreshSelection,
  planBlockedScoreRefresh,
  planDexGatewayCoverageRefresh,
  planDexPriceRefresh,
  planGasRefresh,
  planQuoteDecayRefresh,
} from "../watch/canary-readiness-watch.mjs";

const OUTPUT_PATH = "docs/current-status.md";

function normalizeCurrentStatusDoc(doc) {
  return String(doc || "").replace(/^Updated: .*\n/m, "Updated: <volatile>\n");
}

function money(value) {
  if (!Number.isFinite(value)) return "n/a";
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

function pctText(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function msText(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${Math.round(value)}ms`;
}

function amount(value, ticker) {
  if (!Number.isFinite(value)) return `unknown ${ticker}`;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: value >= 1 ? 6 : 12 })} ${ticker}`;
}

function formatSats(value) {
  if (!Number.isFinite(value)) return "0 sats";
  return `${Math.round(value).toLocaleString("en-US")} sats`;
}

function formatRatio(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(2)}%`;
}

function minimumPaybackProgress(payback = null) {
  return payback?.scheduler?.minimumPaybackProgress || payback?.scheduler?.previewAfterDestination || null;
}

function summarizeBaselineAction(action = null) {
  if (!action) return "none";
  if (action.type === "fund_native" || action.type === "fund_token") {
    return `fund ${amount(action.shortfallDecimal, action.ticker)} on ${action.chain}`;
  }
  if (action.type === "approve_allowance") {
    return `approve ${amount(action.shortfallDecimal, action.ticker)} for spender ${action.spender} on ${action.chain}`;
  }
  return action.summary || action.type || "unknown_action";
}

function linesForActions(actions = []) {
  if (!actions.length) return ["- none"];
  return actions.map((action) => {
    if (action.type === "fund_native") return `- fund ${amount(action.shortfallDecimal, action.ticker)} on ${action.chain}`;
    if (action.type === "fund_token") return `- fund ${amount(action.shortfallDecimal, action.ticker)} on ${action.chain}`;
    if (action.type === "approve_allowance") {
      return `- approve ${amount(action.shortfallDecimal, action.ticker)} for spender ${action.spender} on ${action.chain}`;
    }
    if (action.type === "estimate_exact_gas") return `- run exact gas for ${action.routeKey} amount=${action.amount}`;
    if (action.type === "rerun_scoring") return `- rerun scoring for ${action.routeKey} amount=${action.amount}`;
    return `- ${action.type}`;
  });
}

function readinessRefreshLine(refresh) {
  if (!refresh) return "- Refresh status: no next readiness check";
  if (refresh.state === "ready_now") return "- Refresh status: ready to rerun the next wallet readiness check now";
  if (refresh.state === "cooldown") {
    const age = Number.isFinite(refresh.ageSeconds) ? `${refresh.ageSeconds}s ago` : "recently";
    const remaining =
      Number.isFinite(refresh.maxAgeSeconds) && Number.isFinite(refresh.ageSeconds)
        ? `${Math.max(0, refresh.maxAgeSeconds - refresh.ageSeconds)}s remaining`
        : "cooldown active";
    return `- Refresh status: last readiness observation ${age}; ${remaining}`;
  }
  return `- Refresh status: ${refresh.reason || "unknown"}`;
}

function latestWholeWalletRouteFundingPlan(records = [], { routeKey = null, amount = null } = {}) {
  return [...(records || [])]
    .filter((item) => (!routeKey || item.routeKey === routeKey))
    .filter((item) => (!amount || String(item.amount) === String(amount)))
    .sort((left, right) => new Date(right?.observedAt || 0) - new Date(left?.observedAt || 0))[0] || null;
}

function liveBaselineLines(liveBaseline = null) {
  if (!liveBaseline) return ["- Baseline: unavailable"];
  const operatorLines = (liveBaseline.blockers?.operator || []).map((blocker) => {
    if (blocker.code === "fund_and_approve_wallet") {
      return `- Operator blocker: decision=\`${blocker.decision || "unknown"}\` reasons=${blocker.reasons?.join(",") || "none"} actions=${blocker.actions?.map(summarizeBaselineAction).join(" · ") || "none"}`;
    }
    if (blocker.code === "payback_destination_env_missing") {
      return `- Operator blocker: status=\`${blocker.code}\` env=\`${blocker.requiredEnvName || "n/a"}\` next=\`${blocker.nextActionCode || "none"}\``;
    }
    return `- Operator blocker: status=\`${blocker.code}\``;
  });
  const technicalLines = (liveBaseline.blockers?.technical || []).map(
    (blocker) =>
      `- Technical blocker: status=\`${blocker.code}\`${blocker.status ? ` fork=\`${blocker.status}\`` : ""}${blocker.planId ? ` planId=\`${blocker.planId}\`` : ""}`,
  );
  const objectiveLines = (liveBaseline.blockers?.objective || []).map((blocker) => {
    if (blocker.code === "planned_payback_below_minimum") {
      return `- Objective blocker: status=\`${blocker.code}\` grossTarget=\`${formatSats(blocker.grossTargetBeforeCostsSats)}\` min=\`${formatSats(blocker.minPaybackSats)}\` remaining=\`${formatSats(blocker.remainingSats)}\``;
    }
    if (blocker.code === "guarded_blocked") {
      return `- Objective blocker: status=\`${blocker.code}\` high=${blocker.highSeverityCount ?? 0} issues=${blocker.issueCount ?? 0}`;
    }
    return `- Objective blocker: status=\`${blocker.code}\`${blocker.nextActionCode ? ` next=\`${blocker.nextActionCode}\`` : ""}`;
  });
  return [
    `- Baseline: status=\`${liveBaseline.status}\` stage=\`${liveBaseline.currentStageId || "none"}\` route=\`${liveBaseline.route?.routeLabel || "none"}\` amount=\`${liveBaseline.route?.amount || "n/a"}\``,
    `- Blocker counts: refreshInputs=${liveBaseline.counts?.requiredRefreshCount ?? 0} operator=${liveBaseline.counts?.operator ?? 0} technical=${liveBaseline.counts?.technical ?? 0} objective=${liveBaseline.counts?.objective ?? 0} total=${liveBaseline.counts?.total ?? 0}`,
    ...(liveBaseline.blockers?.refresh?.length
      ? [
          `- Refresh blocker: status=\`${liveBaseline.blockers.refresh[0].code}\` required=${liveBaseline.blockers.refresh[0].requiredRefreshCount ?? 0} next=\`${liveBaseline.blockers.refresh[0].nextActionCode || "none"}\``,
        ]
      : ["- Refresh blocker: none"]),
    ...(operatorLines.length ? operatorLines : ["- Operator blocker: none"]),
    ...(technicalLines.length ? technicalLines : ["- Technical blocker: none"]),
    ...(objectiveLines.length ? objectiveLines : ["- Objective blocker: none"]),
    `- Baseline next action: category=\`${liveBaseline.nextAction?.category || "none"}\` code=\`${liveBaseline.nextAction?.code || "none"}\`${liveBaseline.nextAction?.command ? ` command=\`${liveBaseline.nextAction.command}\`` : ""}`,
  ];
}

function tradeReadinessLine(best) {
  if (!best?.tradeReadiness) return "- Objective score blocker: none";
  if (best.tradeReadiness === "reject_no_net_edge") {
    return Number.isFinite(best.netEdgeUsd)
      ? `- Objective score blocker: reject_no_net_edge (net edge ${money(best.netEdgeUsd)})`
      : "- Objective score blocker: reject_no_net_edge";
  }
  return `- Objective score blocker: ${best.tradeReadiness}`;
}

function nextFocusLine(best) {
  if (!best?.tradeReadiness) return null;
  if (best.tradeReadiness === "reject_no_net_edge") {
    return "- Next focus: rerun quotes, gas, or token prices only when market inputs change; wallet readiness is no longer the blocker";
  }
  return null;
}

function quoteDecayLine(audit) {
  const windows = audit?.quoteDecayWindows || [];
  if (!windows.length) return "- Quote decay: no shadow decay windows yet";
  const required = windows.filter((item) => [5, 15, 30].includes(item.windowSeconds));
  if (!required.length) return "- Quote decay: no 5s/15s/30s windows yet";
  const withCoverage = required.filter((item) => (item.profitableStartGroups || item.coveredGroups || 0) > 0);
  if (!withCoverage.length) return "- Quote decay: collecting initial decay samples";
  return `- Quote decay: ${withCoverage
    .map((item) => `${item.windowSeconds}s ${item.survivedGroups}/${item.profitableStartGroups || item.coveredGroups}`)
    .join(" · ")}`;
}

function overfitAuditLines(audit) {
  if (!audit) return ["- Overfit audit: unavailable"];
  const blockers = audit.blockers?.join(", ") || "none";
  const warnings = audit.warningLabels?.join(", ") || "none";
  const lines = [
    `- Overfit audit: ${audit.decision} · sample=${audit.sampleSource || "unknown"} · horizon=${Number.isFinite(audit.shadowHours) ? `${audit.shadowHours.toFixed(1)}h` : "n/a"} · buckets=${audit.hourBuckets ?? "n/a"}`,
    `- Overfit blockers: ${blockers}`,
    `- Overfit warnings: ${warnings}`,
  ];
  if (Number.isFinite(audit.remainingShadowHours) || Number.isFinite(audit.remainingHourBuckets)) {
    lines.push(
      `- Overfit runway: ${Number.isFinite(audit.remainingShadowHours) ? `${audit.remainingShadowHours.toFixed(1)}h remaining to ${audit.targetShadowHours}h` : "shadow runway n/a"} · ${Number.isFinite(audit.remainingHourBuckets) ? `${audit.remainingHourBuckets} hourly buckets remaining to ${audit.targetHourBuckets}` : "bucket runway n/a"}`,
    );
  }
  if (audit.earliestShadowWindowReadyAt || audit.earliestHourBucketReadyAt || audit.earliestTimeGateReadyAt) {
    lines.push(
      `- Overfit time ETA: shadow window ${audit.earliestShadowWindowReadyAt || "n/a"} · bucket diversity ${audit.earliestHourBucketReadyAt || "n/a"} · earliest time-gate pass ${audit.earliestTimeGateReadyAt || "n/a"}`,
    );
  }
  return lines;
}

function priceCoverageLine(market) {
  if (!market) return "- Chain price coverage: unavailable";
  return `- Chain price coverage: observed ${market.observedChainCount ?? 0}, stale ${market.staleChainCount ?? 0}, missing ${market.missingChainCount ?? 0}`;
}

function coverageReasonLabel(reason) {
  if (String(reason || "").startsWith("no_supported_router_for_chain:")) return "DEX unsupported";
  return {
    dex_quote_observed: "observed",
    btc_spot_reference: "BTC spot reference",
    odos_chain_not_supported: "DEX unsupported",
    stable_quote_token_missing: "quote token missing",
    eligible_quote_not_run: "awaiting quote refresh",
    wrapped_btc_leg_not_sampled: "awaiting sample",
    odos_quote_failed: "recent quote failed",
    input_is_quote_stable: "stable pair skipped",
  }[reason || ""] || String(reason || "unknown");
}

function quoteableCoverageLine(market) {
  const prices = market?.chainWbtcPrices || [];
  const observed = prices.filter((item) => item?.quoteable && Number.isFinite(item?.usd)).map((item) => item.chain);
  const missing = prices
    .filter((item) => item?.quoteable && !Number.isFinite(item?.usd))
    .map((item) => `${item.chain}:${coverageReasonLabel(item.coverageReason)}`);
  const unsupported = prices
    .filter((item) => item?.chain !== "bitcoin" && !item?.quoteable)
    .map((item) => `${item.chain}:${coverageReasonLabel(item.coverageReason)}`);
  return [
    `- Quoteable chains observed: ${observed.join(",") || "none"}`,
    `- Quoteable chains missing: ${missing.join(",") || "none"}`,
    `- Non-quoteable chains: ${unsupported.join(",") || "none"}`,
  ];
}

function btcWatchlistLines(summary) {
  if (!summary) return ["- BTC watchlist coverage: unavailable"];
  return [
    `- BTC watchlist observed live: ${summary.observedTickers?.join(", ") || "none"}`,
    `- BTC watchlist missing from live routes: ${summary.missingTickers?.join(", ") || "none"}`,
    `- BTC watchlist unknown addresses: ${summary.unknownAssets?.map((item) => `${item.chain}:${item.token}`).join(", ") || "none"}`,
  ];
}

function buildBtcWatchlistFallbackSummary(routes = []) {
  const assetUniverse = classifyGatewayAssetUniverse(routes);
  const uniqueTickers = (items = []) => [...new Set(items.map((item) => item.ticker).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    observedTickers: uniqueTickers(assetUniverse.watchlistObserved),
    missingTickers: uniqueTickers(assetUniverse.watchlistMissing),
    unknownAssets: assetUniverse.unknownAssets.map((item) => ({
      chain: item.chain,
      token: item.token,
    })),
  };
}

function formatRate(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function compactReasons(reasons = []) {
  if (!reasons.length) return "none";
  return reasons.map((item) => `${item.reason}:${item.count}`).join(",");
}

function shadowRosterLines(routePlan, evidenceInput = {}) {
  const candidates = (routePlan?.topCandidates || []).slice(0, 5);
  if (!candidates.length) return ["- none"];
  return candidates.map((candidate, index) => {
    const role =
      index === 0 ? "active_canary" :
      candidate?.viableForPrep ? "prep_candidate" :
      candidate?.txReady ? "tx_ready_shadow" :
      "research_candidate";
    const blockers = [
      ...(candidate.prepBlockers || []).map((item) => `prep:${item}`),
      ...(candidate.scoreDisqualifiers || []).map((item) => `score:${item}`),
      ...(candidate.readinessFailureReason ? [`readiness:${candidate.readinessFailureReason}`] : []),
    ];
    const evidence = summarizeShadowCandidateEvidence({
      candidate,
      quotes: evidenceInput.quotes || [],
      quoteFailures: evidenceInput.quoteFailures || [],
      shadowObservations: evidenceInput.shadowObservations || [],
      scores: evidenceInput.scores || [],
    });
    const priority =
      (evidence?.shadowObservationCount || 0) === 0 ? "no_shadow_evidence" :
      (evidence?.quoteAttemptCount || 0) < 2 ? "thin_quote_samples" :
      Number.isFinite(evidence?.quoteSuccessRate) && evidence.quoteSuccessRate < 0.8 ? "low_quote_success_rate" :
      (evidence?.shadowObservationCount || 0) < 3 ? "thin_shadow_observations" :
      Number.isFinite(evidence?.quoteLatencyP95Ms) && evidence.quoteLatencyP95Ms > 2000 ? "high_quote_latency" :
      "evidence_accumulating";
    return `- ${role} route=\`${candidate.label}\` amount=\`${candidate.amount}\` txReady=${Boolean(candidate.txReady)} viableForPrep=${Boolean(candidate.viableForPrep)} net=${money(candidate.netEdgeUsd)} prepFunding=${money(candidate.prepFundingUsd)} blockers=${blockers.join(",") || "none"} priority=${priority} evidence=shadow:${evidence?.shadowObservationCount ?? 0} quotes:${evidence?.quoteSampleCount ?? 0}/${evidence?.quoteAttemptCount ?? 0} success:${formatRate(evidence?.quoteSuccessRate)} p95:${evidence?.quoteLatencyP95Ms ?? "n/a"}ms fee:${money(evidence?.latestKnownCostUsd)} reasons:${compactReasons(evidence?.rejectionReasons || [])}`;
  });
}

function shadowActionLines(routePlan, address) {
  const candidates = (routePlan?.topCandidates || []).slice(0, 5);
  if (!candidates.length) return ["- none"];
  return candidates.map((candidate, index) => {
    const role =
      index === 0 ? "active_canary" :
      candidate?.viableForPrep ? "prep_candidate" :
      candidate?.txReady ? "tx_ready_shadow" :
      "research_candidate";
    const action = shadowActionForCandidate(candidate, { address });
    if (!action) return `- ${role} route=\`${candidate.label}\` next=none`;
    return `- ${role} route=\`${candidate.label}\` next=${action.code} reason=${action.reason || "unknown"}${action.command ? ` command=\`${action.command}\`` : ""}`;
  });
}

function refreshQueueLines(refreshQueue = []) {
  if (!refreshQueue.length) return ["- none"];
  return refreshQueue.map((item) => {
    const targets = item.routeLabel
      ? ` route=\`${item.routeLabel}\``
      : item.proxyGroup
        ? ` proxyGroup=\`${item.proxyGroup}\``
        : "";
    const amount = item.amount ? ` amount=\`${item.amount}\`` : "";
    const chains = item.chains?.length ? ` chains=${item.chains.join(",")}` : "";
    return `- rank=${item.rank ?? "n/a"} priority=${item.priority ?? "n/a"} scope=${item.scope || "unknown"} next=${item.code || "unknown"} reason=${item.reason || "unknown"}${targets}${amount}${chains}${item.command ? ` command=\`${item.command}\`` : ""}`;
  });
}

function refreshExecutionLines(refreshExecution = null) {
  if (!refreshExecution) return ["- none"];
  const lines = [
    `- Summary: runs=${refreshExecution.runCount ?? 0} success=${refreshExecution.successCount ?? 0} failed=${refreshExecution.failureCount ?? 0} preview=${refreshExecution.previewCount ?? 0} invalid=${refreshExecution.invalidCount ?? 0} latest=${refreshExecution.latestStatus || "none"}`,
  ];
  if (!refreshExecution.recentExecutions?.length) {
    lines.push("- Recent executions: none");
    return lines;
  }
  lines.push(
    ...refreshExecution.recentExecutions.map((item) =>
      `- Execution: rank=${item.rank ?? "n/a"} scope=${item.scope || "unknown"} code=${item.code || "unknown"} status=${item.executionStatus || "unknown"} route=\`${item.routeLabel || "unknown"}\` amount=\`${item.amount || "n/a"}\`${item.invalidReason ? ` reason=${item.invalidReason}` : ""}${item.scripts?.length ? ` scripts=${item.scripts.join(",")}` : ""}`,
    ),
  );
  return lines;
}

function refreshBatchLines(refreshBatch = null) {
  if (!refreshBatch) return ["- none"];
  const lines = [
    `- Summary: runs=${refreshBatch.runCount ?? 0} success=${refreshBatch.successCount ?? 0} failed=${refreshBatch.failureCount ?? 0} blocked=${refreshBatch.blockedCount ?? 0} invalid=${refreshBatch.invalidCount ?? 0} latest=${refreshBatch.latestStatus || "none"} stopReason=${refreshBatch.latestStopReason || "none"}`,
  ];
  if (!refreshBatch.recentBatches?.length) {
    lines.push("- Recent batches: none");
    return lines;
  }
  lines.push(
    ...refreshBatch.recentBatches.map((item) =>
      `- Batch: mode=\`${item.mode || "unknown"}\` status=\`${item.batchStatus || "unknown"}\` selected=${item.selectedCount ?? 0} queueSuccess=${item.queueSuccessCount ?? 0} queueFailure=${item.queueFailureCount ?? 0} followUpFailure=${item.followUpFailureCount ?? 0} stopReason=${item.stopReason || "none"} breakerBlocked=${item.circuitBreakerBlocked}`,
    ),
  );
  return lines;
}

function objectivePlanLines(objectivePlans = null) {
  if (!objectivePlans?.executionReview && !objectivePlans?.discovery) return ["- none"];
  const lines = [];
  if (objectivePlans.executionReview) {
    lines.push(
      `- Execution review: route=\`${objectivePlans.executionReview.label || objectivePlans.executionReview.routeKey}\` amount=\`${objectivePlans.executionReview.amount}\` status=\`${objectivePlans.executionReview.status}\` next=\`${objectivePlans.executionReview.nextActionCode}\` blockers=${objectivePlans.executionReview.blockers.join(",") || "none"}`,
    );
    if (objectivePlans.executionReview.reasonLabels?.length) {
      lines.push(`- Execution review rationale: ${objectivePlans.executionReview.reasonLabels.join("; ")}`);
    }
    if (objectivePlans.executionReview.command) {
      lines.push(`- Execution review command: \`${objectivePlans.executionReview.command}\``);
    }
  }
  if (objectivePlans.discovery) {
    lines.push(
      `- Discovery candidate: route=\`${objectivePlans.discovery.label || objectivePlans.discovery.routeKey}\` amount=\`${objectivePlans.discovery.amount}\` source=\`${objectivePlans.discovery.source}\` status=\`${objectivePlans.discovery.status}\` next=\`${objectivePlans.discovery.nextActionCode}\` reason=\`${objectivePlans.discovery.reason}\``,
    );
    if (objectivePlans.discovery.command) {
      lines.push(`- Discovery command: \`${objectivePlans.discovery.command}\``);
    }
  }
  return lines;
}

function blockersText(blockers = []) {
  return blockers.join(",") || "none";
}

function paybackLines(payback = null) {
  if (!payback) return ["- Payback readiness unavailable"];
  const minimumProgress = minimumPaybackProgress(payback);
  const lines = [
    `- Scheduler: status=\`${payback.scheduler?.status || "unknown"}\` reason=\`${payback.scheduler?.reason || "unknown"}\` next=\`${payback.scheduler?.nextAction || "none"}\``,
    `- Balances: pending=\`${formatSats(payback.accumulatorPendingSats)}\` grossProfitPeriod=\`${formatSats(payback.grossProfitSatsPeriod)}\` lifetimePaid=\`${formatSats(payback.paidBackSatsLifetime)}\``,
    Number.isFinite(payback.lastPaybackSettledSats)
      ? `- Last settled: \`${formatSats(payback.lastPaybackSettledSats)}\` at \`${payback.lastPaybackSettledAt || "unknown"}\``
      : "- Last settled: none yet",
    "- Preview command: `npm run report:payback-status -- --json`",
  ];
  if (payback.scheduler?.requiredEnvName) {
    lines.splice(2, 0, `- Required env: \`${payback.scheduler.requiredEnvName}\``);
  }
  if (minimumProgress) {
    const label = minimumProgress.source === "current" ? "Current minimum gap" : "After destination is set";
    lines.splice(
      lines.length - 1,
      0,
      `- ${label}: status=\`${minimumProgress.status || "unknown"}\` reason=\`${minimumProgress.reason || "unknown"}\` grossTarget=\`${formatSats(minimumProgress.grossTargetBeforeCostsSats)}\` minPayback=\`${formatSats(minimumProgress.minPaybackSats)}\` remaining=\`${formatSats(minimumProgress.satsToMinimumPayback)}\` progress=\`${formatRatio(minimumProgress.progressToMinimumRatio)}\``,
    );
  }
  return lines;
}

function preliveLines(prelive = null) {
  if (!prelive) return ["- Pre-live readiness: unavailable"];
  const lines = [
    `- Current stage: \`${prelive.currentStage}\``,
    `- Shadow replay: \`${prelive.shadowReplay.status}\` blockers=${blockersText(prelive.shadowReplay.blockers)} audit=${prelive.shadowReplay.auditDecision || "n/a"} policyReady=${prelive.shadowReplay.policyReadyMeasuredRoutes ?? 0}`,
    `- Mechanical simulation: \`${prelive.mechanicalSimulation.status}\` success=${prelive.mechanicalSimulation.successCount}/${prelive.mechanicalSimulation.targetSuccessCount} failures=${prelive.mechanicalSimulation.failureCount} unresolved=${prelive.mechanicalSimulation.unresolvedFailureCount ?? 0} remediated=${prelive.mechanicalSimulation.remediatedFailureCount ?? 0} historical=${prelive.mechanicalSimulation.historicalFailureCount ?? 0} blockers=${blockersText(prelive.mechanicalSimulation.blockers)}`,
    `- Fork execution: \`${prelive.forkExecution.status}\` planned=${prelive.forkExecution.planCount} submitted=${prelive.forkExecution.submittedCount} confirmed=${prelive.forkExecution.confirmedCount}/${prelive.forkExecution.targetConfirmedCount} failures=${prelive.forkExecution.failedCount} blockers=${blockersText(prelive.forkExecution.blockers)}`,
    `- Execution audit: \`${prelive.executionAudit.status}\` missingRecords=${prelive.executionAudit.missingRecordCount} blockers=${blockersText(prelive.executionAudit.blockers)}`,
    `- Tiny live canary review: \`${prelive.tinyLiveCanary.status}\` blockers=${blockersText(prelive.tinyLiveCanary.blockers)} livePolicy=\`${prelive.liveTradingPolicy}\``,
    "- Pre-live commands: `npm run run:prelive-evidence-campaign` or `npm run run:prelive-simulations -- --source=objective --write` && `npm run plan:prelive-fork-execution -- --source=objective --write` && `npm run report:prelive-readiness -- --write` && `npm run build:prelive-review-package -- --write` && `npm run status:dashboard`",
  ];
  if (prelive.mechanicalSimulation.latestFailureReason) {
    lines.push(
      `- Latest simulation failure: ${prelive.mechanicalSimulation.latestFailureReason} at ${prelive.mechanicalSimulation.latestFailureAt || "unknown"}`,
    );
  }
  if (prelive.forkExecution.latestPlan) {
    lines.push(
      `- Latest fork plan: route=\`${prelive.forkExecution.latestPlan.routeLabel || prelive.forkExecution.latestPlan.routeKey}\` amount=\`${prelive.forkExecution.latestPlan.amount}\` status=\`${prelive.forkExecution.latestPlan.status}\` source=\`${prelive.forkExecution.latestPlan.selectionSource || "unknown"}\``,
    );
  }
  if (prelive.forkExecution.latestSubmission) {
    lines.push(
      `- Latest fork submission: route=\`${prelive.forkExecution.latestSubmission.routeLabel || "unknown"}\` amount=\`${prelive.forkExecution.latestSubmission.amount || "n/a"}\` status=\`${prelive.forkExecution.latestSubmission.submissionStatus}\` chain=\`${prelive.forkExecution.latestSubmission.chain || "unknown"}\``,
    );
  }
  if (prelive.forkExecution.latestReceipt) {
    lines.push(
      `- Latest fork receipt: route=\`${prelive.forkExecution.latestReceipt.routeLabel || "unknown"}\` amount=\`${prelive.forkExecution.latestReceipt.amount || "n/a"}\` status=\`${prelive.forkExecution.latestReceipt.reconciliationStatus}\` failed=${prelive.forkExecution.latestReceipt.failed}`,
    );
  }
  if (prelive.executionAudit.recentTransitions?.length) {
    lines.push(
      ...prelive.executionAudit.recentTransitions.slice(0, 4).map((item) =>
        `- Recent execution transition: kind=\`${item.kind}\` status=\`${item.status}\` route=\`${item.routeLabel || "unknown"}\` amount=\`${item.amount || "n/a"}\`${item.reason ? ` reason=${item.reason}` : ""}`,
      ),
    );
  }
  if (prelive.nextActions?.length) {
    lines.push(
      ...prelive.nextActions.map((action) =>
        `- Queue follow-up: rank=${action.rank ?? "n/a"} scope=${action.scope || "unknown"} label=\`${action.label || "unknown"}\` reason=${action.reason || "unknown"}${action.command ? ` command=\`${action.command}\`` : ""}`,
      ),
    );
  }
  return lines;
}

function watcherReasonLabel(kind, reason) {
  return {
    canaryInputs: {
      stale_canary_route_inputs: "current canary route inputs are stale",
      missing_canary_route_inputs: "current canary route inputs are missing",
      canary_route_inputs_fresh: "current canary route inputs are fresh",
      no_active_canary_route: "no active canary route",
      not_applicable: "canary input refresh not needed right now",
    },
    gasRefresh: {
      stale_src_gas_snapshot: "source gas snapshot is stale",
      not_stale_src_gas_blocked: "gas freshness is not the active blocker",
      route_missing: "route information is missing",
      src_chain_not_supported: "source chain is not an EVM gas snapshot target",
      not_applicable: "gas refresh not needed right now",
    },
    dexRefresh: {
      missing_chain_price: "current canary route chain price is missing",
      stale_chain_price: "current canary route chain price is stale",
      missing_gateway_chain_price: "quoteable gateway chain price is missing",
      stale_gateway_chain_price: "quoteable gateway chain price is stale",
      chain_prices_fresh: "observed chain prices are fresh",
      not_applicable: "dex refresh not needed right now",
    },
    blockedScore: {
      newer_market_inputs: "new market inputs arrived after the score snapshot",
      score_inputs_unchanged: "no new score inputs arrived",
      score_missing: "score snapshot is missing",
      not_net_edge_blocked: "blocker is not net edge",
      not_applicable: "blocked-score refresh not needed right now",
    },
    quoteDecay: {
      missing_decay_observation: "no decay observations yet",
      waiting_decay_window: "next decay window has not opened yet",
      due_decay_window: "next decay window is due now",
      decay_windows_complete: "baseline decay windows are already covered",
      not_applicable: "quote-decay refresh not needed right now",
    },
    gatewayCoverage: {
      missing_gateway_focus_quotes: "fully measurable route still needs a Gateway probe",
      gateway_focus_covered: "focus shortlist already has Gateway coverage",
      no_fully_measurable_routes: "no fully measurable DEX route subset yet",
      not_applicable: "gateway coverage refresh not needed right now",
    },
  }[kind]?.[reason] || reason || "unknown";
}

function gasRefreshLine(refresh) {
  if (!refresh?.routeKey) return "- Gas refresh watcher: no route selected";
  if (refresh.shouldRefresh) {
    return `- Gas refresh watcher: refresh ${refresh.chains.join(",") || "source-chain"} and rerun ${refresh.routeKey} amount=${refresh.amount} (${watcherReasonLabel("gasRefresh", refresh.reason)})`;
  }
  return `- Gas refresh watcher: skip ${refresh.routeKey} amount=${refresh.amount} (${watcherReasonLabel("gasRefresh", refresh.reason)})`;
}

function changedInputLabel(type) {
  return {
    quote: "gateway quote",
    exact_gas: "exact gas",
    dex_quote: "DEX quote",
    src_gas_snapshot: "source gas snapshot",
    bitcoin_fee: "bitcoin fee",
    src_price: "source price",
    dst_price: "destination price",
    score_missing: "missing score snapshot",
  }[type] || type;
}

function dexRefreshTargetCount(refresh, state) {
  const scores = state?.scoreSnapshot?.scores || [];
  if (refresh?.routeKey && refresh?.amount) {
    return scores.filter((item) => item.routeKey === refresh.routeKey && String(item.amount) === String(refresh.amount)).length;
  }
  return scores.filter((item) => refresh?.chains?.includes(item.dstChain) && item?.dstAsset?.family === "wrapped_btc").length;
}

function dexRefreshLine(refresh, state) {
  if (!refresh?.chains?.length) return "- DEX refresh watcher: no eligible chain set";
  const targetCount = dexRefreshTargetCount(refresh, state);
  const targetText = Number.isFinite(targetCount) ? `; rescoring ${targetCount} wrapped-BTC route(s)` : "";
  if (refresh.shouldRefresh) {
    const scope = refresh.routeKey && refresh.amount ? `route ${refresh.routeKey} amount=${refresh.amount}` : `dst chains ${refresh.chains.join(",")}`;
    return `- DEX refresh watcher: refresh ${scope}${targetText} (${watcherReasonLabel("dexRefresh", refresh.reason)})`;
  }
  return `- DEX refresh watcher: skip ${refresh.chains.join(",")}${targetText} (${watcherReasonLabel("dexRefresh", refresh.reason)})`;
}

function blockedScoreLine(refresh) {
  if (!refresh?.routeKey) return "- Blocked-score watcher: no route selected";
  const selection = describeBlockedScoreRefreshSelection(refresh, {
    srcChain: refresh.srcChain,
    dstChain: refresh.dstChain,
  });
  const scopeText = selection.scope === "touch_chains" ? `touching ${selection.chains.join(",")}; ` : "";
  const inputs = refresh.changedInputs.map(changedInputLabel).join(", ") || "inputs unknown";
  if (refresh.shouldRefresh) {
    return `- Blocked-score watcher: rerun ${scopeText}${refresh.routeKey} amount=${refresh.amount} (${watcherReasonLabel("blockedScore", refresh.reason)}; ${inputs})`;
  }
  return `- Blocked-score watcher: skip ${refresh.routeKey} amount=${refresh.amount} (${watcherReasonLabel("blockedScore", refresh.reason)})`;
}

function quoteDecayRefreshLine(refresh) {
  if (!refresh?.routeKey) return "- Quote-decay watcher: no route selected";
  if (refresh.shouldRefresh) {
    return `- Quote-decay watcher: refresh ${refresh.routeKey} amount=${refresh.amount} (${watcherReasonLabel("quoteDecay", refresh.reason)}; window ${refresh.pendingWindowSeconds || "n/a"}s)`;
  }
  return `- Quote-decay watcher: skip ${refresh.routeKey} amount=${refresh.amount} (${watcherReasonLabel("quoteDecay", refresh.reason)}${refresh.pendingWindowSeconds ? `; window ${refresh.pendingWindowSeconds}s` : ""})`;
}

function canaryInputRefreshLine(refresh) {
  if (!refresh?.routeKey) return "- Canary input watcher: no active canary route";
  const inputs = refresh.inputKeys?.join(",") || "none";
  if (refresh.shouldRefresh) {
    return `- Canary input watcher: refresh ${refresh.routeKey} amount=${refresh.amount} inputs=${inputs} (${watcherReasonLabel("canaryInputs", refresh.reason)})`;
  }
  return `- Canary input watcher: skip ${refresh.routeKey} amount=${refresh.amount} (${watcherReasonLabel("canaryInputs", refresh.reason)})`;
}

function gatewayCoverageLine(refresh) {
  if (!refresh?.targetRouteCount) return "- Gateway coverage watcher: no fully measurable route shortlist yet";
  const targets = (refresh.targetRoutes || []).map((item) => item.routeKey).join(", ") || "none";
  const chains = refresh.touchChains?.join(",") || "none";
  if (refresh.shouldRefresh) {
    return `- Gateway coverage watcher: probe ${refresh.targetRouteCount} focus route(s) (${targets}) and rescore chains ${chains} (${watcherReasonLabel("gatewayCoverage", refresh.reason)})`;
  }
  return `- Gateway coverage watcher: skip ${refresh.targetRouteCount} focus route(s) (${watcherReasonLabel("gatewayCoverage", refresh.reason)})`;
}

function lastAdvanceLine(advance) {
  if (!advance) return "- Last canary advance: none recorded";
  const actions = (advance.actions || []).join(", ") || "no_actions";
  const initial = advance.initial?.decision || "unknown";
  const final = advance.final?.decision || "unknown";
  const route = advance.final?.routeLabel || advance.initial?.routeLabel || "no_route";
  return `- Last canary advance: ${route} (${initial} -> ${final}; actions ${actions})`;
}

function freshnessText(name, item) {
  const ageText = Number.isFinite(item?.ageMinutes) ? `${item.ageMinutes.toFixed(1)}m` : "n/a";
  const failureText = item?.failureReason ? `:${item.failureReason}` : "";
  return `${name} ${item?.state || "unknown"}${failureText}${item?.state === "fresh" || item?.state === "stale" ? ` (${ageText})` : ""}`;
}

function canaryInputsLines(summary) {
  if (!summary) return ["- Route input freshness: no active canary route"];
  return [
    `- Route input freshness: ${[
      freshnessText("quote", summary.gatewayQuote),
      freshnessText("exactGas", summary.exactGas),
      freshnessText("srcGas", summary.srcGas),
      freshnessText("dex", summary.dexQuote),
      freshnessText("btcFee", summary.bitcoinFee),
      freshnessText("market", summary.marketSnapshot),
    ].join(" · ")}`,
    `- Route input blockers: ${summary.blockers.join(",") || "none"}${summary.scoreDataGaps?.length ? `; score gaps ${summary.scoreDataGaps.join(",")}` : ""}`,
  ];
}

function preliveReviewPackageLines(reviewPackage = null, options = {}) {
  const wholeWalletFunding = options.wholeWalletFunding || null;
  if (!reviewPackage) return ["- Review package unavailable"];
  const candidate = reviewPackage.primaryLiveCandidate || reviewPackage.manualReviewCandidate || null;
  const leader = reviewPackage.measuredLeaderReview || null;
  const lines = [
    `- Summary: status=\`${reviewPackage.packageStatus || "unknown"}\` review=\`${reviewPackage.reviewDecision || "unknown"}\` live=\`${reviewPackage.liveDecision || "unknown"}\` stage=\`${reviewPackage.currentStage || "unknown"}\` blockers=${reviewPackage.reviewBlockers.join(",") || "none"}`,
  ];
  if (reviewPackage.tinyCanaryAdmission) {
    lines.push(
      `- Tiny canary admission: decision=\`${reviewPackage.tinyCanaryAdmission.decision || "unknown"}\` status=\`${reviewPackage.tinyCanaryAdmission.status || "unknown"}\` blockers=${reviewPackage.tinyCanaryAdmission.blockers.join(",") || "none"} next=\`${reviewPackage.tinyCanaryAdmission.nextActionCode || "none"}\``,
    );
  }
  if (reviewPackage.remediationPlan) {
    lines.push(
      `- Admission remediation: status=\`${reviewPackage.remediationPlan.overallStatus || "unknown"}\` ready=${reviewPackage.remediationPlan.readyCount ?? 0} manual=${reviewPackage.remediationPlan.manualCount ?? 0} blocked=${reviewPackage.remediationPlan.blockedCount ?? 0}`,
    );
    if (reviewPackage.remediationPlan.runnerCommand) {
      lines.push(`- Admission remediation runner: \`${reviewPackage.remediationPlan.runnerCommand}\``);
    }
    if (reviewPackage.remediationPlan.nextAction) {
      lines.push(
        `- Admission next action: \`${reviewPackage.remediationPlan.nextAction.code || "unknown"}\` status=\`${reviewPackage.remediationPlan.nextAction.status || "unknown"}\`${reviewPackage.remediationPlan.nextAction.command ? ` command=\`${reviewPackage.remediationPlan.nextAction.command}\`` : ""}`,
      );
      if (reviewPackage.remediationPlan.nextAction.code === "collect_wrapped_btc_loop_oos_receipts") {
        const receiptGuide = buildWrappedBtcLoopReceiptGuide();
        lines.push(`- Wrapped-loop receipt template: \`${receiptGuide.sampleCommand}\``);
        lines.push(`- Wrapped-loop receipt fields: ${receiptGuide.requiredFields.join(", ")}`);
      }
    }
    lines.push(
      ...(reviewPackage.remediationPlan.items || []).slice(0, 3).map(
        (entry) =>
          `- Admission remediation item: rank=${entry.rank ?? "n/a"} status=\`${entry.status || "unknown"}\` code=\`${entry.code || "unknown"}\` reason=${entry.reason || "none"}${entry.command ? ` command=\`${entry.command}\`` : ""}`,
      ),
    );
  }
  if (candidate) {
    lines.push(
      `- Manual review candidate: target=\`${candidate.candidateLabel || candidate.routeLabel || candidate.candidateId || candidate.routeKey || "unknown"}\` amount=\`${candidate.amount || "n/a"}\` readiness=\`${candidate.tradeReadiness || "unknown"}\` net=${money(candidate.netEdgeUsd)} prepFunding=${money(candidate.prepFundingUsd)} txReady=${candidate.txReady} viableForPrep=${candidate.viableForPrep}`,
    );
    if (candidate.inputFreshness) {
      lines.push(
        `- Candidate inputs: ${[
          freshnessText("quote", candidate.inputFreshness.gatewayQuote),
          freshnessText("exactGas", candidate.inputFreshness.exactGas),
          freshnessText("srcGas", candidate.inputFreshness.srcGas),
          freshnessText("dex", candidate.inputFreshness.dexQuote),
          freshnessText("btcFee", candidate.inputFreshness.bitcoinFee),
          freshnessText("market", candidate.inputFreshness.marketSnapshot),
        ].join(" · ")}`,
      );
    }
    if (reviewPackage.tinyCanaryAdmission?.constraints) {
      lines.push(
        `- Admission constraints: livePolicy=\`${reviewPackage.tinyCanaryAdmission.constraints.liveTradingPolicy || "unknown"}\` strategyCaps=\`per_strategy\` dailyLoss=\`${reviewPackage.tinyCanaryAdmission.constraints.dailyLossCapUsd ?? "n/a"}\` walletFloor=\`${reviewPackage.tinyCanaryAdmission.constraints.canaryWalletFloorUsd ?? "n/a"}\` minProfit=\`${reviewPackage.tinyCanaryAdmission.constraints.minNetProfitUsd ?? "n/a"}\` minEdge=\`${reviewPackage.tinyCanaryAdmission.constraints.minNetProfitPct ?? "n/a"}\``,
      );
    }
    lines.push(
      `- Candidate blockers: ${candidate.blockerReasons.join(",") || "none"}${candidate.scoreDataGaps?.length ? `; score gaps ${candidate.scoreDataGaps.join(",")}` : ""}`,
    );
    if (candidate.evidence) {
      lines.push(
        `- Candidate evidence: shadow=${candidate.evidence.shadowObservationCount ?? 0} quotes=${candidate.evidence.quoteSampleCount ?? 0}/${candidate.evidence.quoteAttemptCount ?? 0} success=${pctText(candidate.evidence.quoteSuccessRate)} p95=${msText(candidate.evidence.quoteLatencyP95Ms)} routeFailure=${pctText(candidate.evidence.latestRouteFailureRate)}`,
      );
    }
  }
  if (leader) {
    lines.push(
      `- Measured leader review: route=\`${leader.routeLabel || leader.routeKey || "unknown"}\` amount=\`${leader.amount || "n/a"}\` readiness=\`${leader.tradeReadiness || "unknown"}\` measured=${money(leader.measuredNetUsd)} executable=${money(leader.executableNetUsd)} next=\`${leader.nextActionCode || "none"}\``,
    );
    lines.push(`- Leader review rationale: ${leader.reasons.join("; ") || "none"}${leader.blockers.length ? ` | blockers: ${leader.blockers.join(", ")}` : ""}`);
    if (wholeWalletFunding?.status === "route_funding_required") {
      const tokenTop = wholeWalletFunding.recommendations?.tokenTopUps?.[0] || null;
      const nativeTop = wholeWalletFunding.recommendations?.nativeTopUps?.[0] || null;
      lines.push(
        `- Whole-wallet funding hint: nativeGap=${money(wholeWalletFunding.readiness?.nativeShortfallUsd)} tokenGap=\`${wholeWalletFunding.readiness?.tokenShortfall || "0"}\` topToken=\`${tokenTop ? `${tokenTop.chain} ${tokenTop.ticker} ${tokenTop.method}` : "none"}\` topNative=\`${nativeTop ? `${nativeTop.chain} ${nativeTop.ticker} ${nativeTop.method}` : "none"}\``,
      );
      if (wholeWalletFunding.livePreview?.tokenProbe || wholeWalletFunding.livePreview?.nativeProbe) {
        const tokenProbe = wholeWalletFunding.livePreview?.tokenProbe;
        const nativeProbe = wholeWalletFunding.livePreview?.nativeProbe;
        lines.push(
          `- Whole-wallet probe: token=${tokenProbe ? `${tokenProbe.status}/${tokenProbe.blockedReason || "ok"}/covers=${tokenProbe.coversShortfall}` : "n/a"} native=${nativeProbe ? `${nativeProbe.status}/${nativeProbe.blockedReason || "ok"}/covers=${nativeProbe.coversShortfall}` : "n/a"}`,
        );
      }
    }
  }
  if (reviewPackage.ethFamilyProfitability) {
    lines.push(
      `- ETH-family profitability: routes=${reviewPackage.ethFamilyProfitability.routeCount ?? 0} measured=${reviewPackage.ethFamilyProfitability.measuredClosedLoopCount ?? 0} profitable=${reviewPackage.ethFamilyProfitability.profitableClosedLoopCount ?? 0} verdict=\`${reviewPackage.ethFamilyProfitability.verdictCode || "unknown"}\``,
    );
    lines.push(
      `- ETH-family recommendation: \`${reviewPackage.ethFamilyProfitability.recommendationCode || "unknown"}\`${reviewPackage.ethFamilyProfitability.followUpCommand ? ` command=\`${reviewPackage.ethFamilyProfitability.followUpCommand}\`` : ""}`,
    );
  }
  if (reviewPackage.pivotDecision) {
    lines.push(
      `- Pivot gate: decision=\`${reviewPackage.pivotDecision.decisionCode || "unknown"}\` status=\`${reviewPackage.pivotDecision.status || "unknown"}\` currentCanary=\`${reviewPackage.pivotDecision.currentCanaryVerdict || "n/a"}\` measuredLeader=\`${reviewPackage.pivotDecision.measuredLeaderVerdict || "n/a"}\``,
    );
  }
  if (reviewPackage.pivotPlan?.topRecommendation) {
    const top = reviewPackage.pivotPlan.topRecommendation;
    lines.push(`- Pivot review context: top=\`${top.id || "unknown"}\` status=\`${top.status || "unknown"}\` next=\`${top.nextActionCode || "none"}\``);
    if (Number.isFinite(top.observedCapitalFloorUsd) || Number.isFinite(top.researchPilotMinimumUsd)) {
      lines.push(
        `- Pivot capital context: observedFloor=${money(top.observedCapitalFloorUsd)} researchPilot=${money(top.researchPilotMinimumUsd)} defaultSplit=${money(top.defaultDualSleeveMinimumUsd)}`,
      );
    }
  }
  lines.push(
    `- Review checklist: completed=${reviewPackage.operatorChecklist?.completed?.join(" · ") || "none"} remaining=${reviewPackage.operatorChecklist?.remaining?.join(" · ") || "none"}`,
  );
  if (reviewPackage.recentTransitions?.length) {
    lines.push(
      ...reviewPackage.recentTransitions.slice(0, 3).map((item) =>
        `- Review transition: kind=\`${item.kind}\` status=\`${item.status}\` route=\`${item.routeLabel || "unknown"}\` amount=\`${item.amount || "n/a"}\`${item.reason ? ` reason=${item.reason}` : ""}`,
      ),
    );
  }
  if (reviewPackage.queueFollowUps?.length) {
    lines.push(
      ...reviewPackage.queueFollowUps.slice(0, 3).map((item) =>
        `- Review follow-up: rank=${item.rank ?? "n/a"} scope=${item.scope || "unknown"} label=\`${item.label || "unknown"}\` reason=${item.reason || "unknown"}${item.command ? ` command=\`${item.command}\`` : ""}`,
      ),
    );
  }
  if (reviewPackage.antiOverfitCaveats?.length) {
    lines.push(...reviewPackage.antiOverfitCaveats.slice(0, 4).map((item) => `- Guardrail: ${item}`));
  }
  return lines;
}

function preliveEvidenceCampaignLines(campaign = null) {
  if (!campaign) return ["- Evidence campaign unavailable"];
  const lines = [
    `- Summary: status=\`${campaign.overallStatus || "unknown"}\` reviewPackage=\`${campaign.reviewPackageStatus || "unknown"}\` stage=\`${campaign.currentStage || "unknown"}\` ready=${campaign.readyActionCount ?? 0} manual=${campaign.manualActionCount ?? 0} blocked=${campaign.blockedActionCount ?? 0} done=${campaign.doneActionCount ?? 0}`,
    `- Evidence progress: simulations=${campaign.simulation?.successCount ?? 0}/${campaign.simulation?.targetSuccessCount ?? 0} forkConfirmed=${campaign.forkExecution?.confirmedCount ?? 0}/${campaign.forkExecution?.targetConfirmedCount ?? 0} refreshRuns=${campaign.refreshBatch?.runCount ?? 0}`,
  ];
  if (campaign.nextAction) {
    lines.push(
      `- Next campaign action: code=\`${campaign.nextAction.code}\` status=\`${campaign.nextAction.status}\` reason=${campaign.nextAction.reason || "unknown"}${campaign.nextAction.command ? ` command=\`${campaign.nextAction.command}\`` : ""}`,
    );
  }
  lines.push(
    ...(campaign.actions || []).slice(0, 5).map((item) =>
      `- Campaign action: code=\`${item.code}\` status=\`${item.status}\` automated=${item.automated}${item.reason ? ` reason=${item.reason}` : ""}${item.command ? ` command=\`${item.command}\`` : ""}`,
    ),
  );
  return lines;
}

function pivotDecisionLines(pivotDecision = null) {
  if (!pivotDecision) return ["- Pivot decision unavailable"];
  return [
    `- Pivot decision: \`${pivotDecision.decisionCode || "unknown"}\` ${pivotDecision.decisionLabel || ""}`.trim(),
    `- Pivot status: \`${pivotDecision.status || "unknown"}\` currentCanary=\`${pivotDecision.currentCanaryVerdict || "n/a"}\` measuredLeader=\`${pivotDecision.measuredLeaderVerdict || "n/a"}\``,
    pivotDecision.focusRouteKey
      ? `- Pivot focus route: \`${pivotDecision.focusRouteLabel || pivotDecision.focusRouteKey}\` amount=\`${pivotDecision.focusAmount || "n/a"}\``
      : "- Pivot focus route: none",
    pivotDecision.nextActionCode
      ? `- Pivot next action: \`${pivotDecision.nextActionCode}\`${pivotDecision.command ? ` command=\`${pivotDecision.command}\`` : ""}`
      : "- Pivot next action: none",
  ];
}

function pivotPlanLines(pivotPlan = null) {
  if (!pivotPlan?.topRecommendation) return ["- Pivot plan unavailable"];
  const top = pivotPlan.topRecommendation;
  const budgetScenarioLine =
    pivotPlan.budgetScenarios?.length
      ? `- Reference cap scenarios: ${pivotPlan.budgetScenarios
          .map((scenario) => `${money(scenario.budgetUsd)}${scenario.planningOnly ? "(reference)" : "(current)"}`)
          .join(" | ")}`
      : null;
  const lines = [
    `- Pivot capital mode: per-strategy caps note=${pivotPlan.budgetNote || "n/a"}`,
    `- Top recommendation: \`${top.id || "unknown"}\` label=\`${top.label || "unknown"}\` status=\`${top.status || "unknown"}\` reason=\`${top.reason || "unknown"}\``,
  ];
  if (budgetScenarioLine) lines.push(budgetScenarioLine);
  if (Number.isFinite(top.observedCapitalFloorUsd) || Number.isFinite(top.researchPilotMinimumUsd)) {
    lines.push(
      `- Capital guide: observedFloor=${money(top.observedCapitalFloorUsd)} researchPilot=${money(top.researchPilotMinimumUsd)} defaultSplit=${money(top.defaultDualSleeveMinimumUsd)}`,
    );
  }
  if (top.nextActionCode || top.nextActionLabel) {
    lines.push(`- Pivot next action: \`${top.nextActionCode || "unknown"}\` ${top.nextActionLabel || ""}`.trim());
  }
  lines.push(
    ...(pivotPlan.pivots || [])
      .slice(1, 3)
      .map(
        (item) =>
          `- Alternate pivot: \`${item.id || "unknown"}\` status=\`${item.status || "unknown"}\` label=\`${item.label || "unknown"}\`${Number.isFinite(item.observedCapitalFloorUsd) ? ` observedFloor=${money(item.observedCapitalFloorUsd)}` : ""}`,
      ),
  );
  return lines;
}

function yieldShadowBookLines(summary = null, profiles = []) {
  if (!summary?.topProfile) return ["- Yield shadow book unavailable"];
  const top = summary.topProfile;
  const budgetScenarioLine =
    summary.budgetScenarios?.length
      ? `- Yield reference cap scenarios: ${summary.budgetScenarios
          .map((scenario) => `${money(scenario.budgetUsd)} readyProfiles=${scenario.readyProfileCount}${scenario.planningOnly ? "(reference)" : "(current)"}`)
          .join(" | ")}`
      : null;
  const lines = [
    `- Yield book: status=\`${summary.bookStatus || "unknown"}\` profiles=${summary.profileCount ?? 0} withinReferenceCap=${summary.withinBudgetCount ?? 0}`,
    `- Top paper profile: \`${top.id || "unknown"}\` label=\`${top.label || "unknown"}\` status=\`${top.status || "unknown"}\` capital=${money(top.capitalRequiredUsd)} paperDaily(5%)=${money(top.paperDailyBaseScenarioUsd)} paper30d(5%)=${money(top.paperThirtyDayBaseScenarioUsd)}`,
  ];
  if (budgetScenarioLine) lines.push(budgetScenarioLine);
  if (top.nextActionCode || top.nextActionLabel) {
    lines.push(`- Yield next action: \`${top.nextActionCode || "unknown"}\` ${top.nextActionLabel || ""}`.trim());
  }
  lines.push(
    ...profiles
      .filter((profile) => profile.id !== top.id)
      .slice(0, 2)
      .map(
        (profile) =>
          `- Yield profile: \`${profile.id}\` status=\`${profile.status || "unknown"}\` capital=${money(profile.capitalRequiredUsd)} budgetGap=${money(profile.budgetGapUsd)}`,
      ),
  );
  return lines;
}

function proxyCoveragePlanLines(summary = null, entries = []) {
  if (!summary?.nextAction && !entries.length) return ["- Proxy coverage plan unavailable"];
  const top = entries.find((entry) => entry.nextAction !== "watch_surface") || entries[0] || null;
  const lines = [
    `- Proxy coverage: overfit=\`${summary?.overfitAssessment || "unknown"}\` plans=${summary?.planCount ?? entries.length} actionable=${summary?.actionableCount ?? 0} quota=${summary?.totalQuoteQuotaNeeded ?? 0}`,
  ];
  if (top) {
    lines.push(
      `- Next proxy target: proxy=\`${top.proxyGroup || "unknown"}\` action=\`${top.nextAction || "unknown"}\` reason=\`${top.reason || "unknown"}\` priority=\`${top.priority || "unknown"}\` quota=${top.quoteQuotaNeeded ?? 0}`,
    );
    if (top.executionCommand) {
      lines.push(`- Proxy coverage command: \`${top.executionCommand}\``);
    }
  }
  lines.push(
    ...entries
      .filter((entry) => !top || `${entry.proxyGroup}|${entry.nextAction}|${entry.reason}` !== `${top.proxyGroup}|${top.nextAction}|${top.reason}`)
      .slice(0, 2)
      .map(
        (entry) =>
          `- Alternate proxy target: proxy=\`${entry.proxyGroup || "unknown"}\` action=\`${entry.nextAction || "unknown"}\` quota=${entry.quoteQuotaNeeded ?? 0} amounts=${entry.targetAmountLevels?.join(",") || "none"}`,
      ),
  );
  return lines;
}

function strategySnapshotLines(summary = null, snapshot = null, phase3Summary = null) {
  if (!summary?.topPivot && !summary?.topImplementedStrategy) return ["- Strategy snapshot unavailable"];
  const effectivePhase3 = summary.phase3StrategyValidation || phase3Summary || null;
  const phase3TopBlocked = effectivePhase3?.topBlocked || null;
  const phase3NextAction = effectivePhase3?.nextAction || null;
  const lines = [
    `- Strategy snapshot: implemented=${summary.implementedStrategyCount ?? 0} candidates=${summary.candidateForValidationCount ?? 0} capitalMode=per_strategy_caps`,
    `- Top implemented strategy: \`${summary.topImplementedStrategy?.id || "unknown"}\` status=\`${summary.topImplementedStrategy?.status || "unknown"}\` reason=\`${summary.topImplementedStrategy?.reason || "unknown"}\``,
    `- Top pivot: \`${summary.topPivot?.id || "unknown"}\` status=\`${summary.topPivot?.status || "unknown"}\` pilot=${money(summary.topPivot?.researchPilotMinimumUsd)}`,
  ];
  if (summary.catalogScope?.coverage) {
    lines.push(
      `- Catalog scope: \`${summary.catalogScope.coverage}\` excludes=${summary.catalogScope.excludes?.join(",") || "none"}`,
    );
  }
  if (summary.researchBoard) {
    lines.push(
      `- Research board: candidates=${summary.researchBoard.candidateCount ?? 0} top=\`${summary.researchBoard.topCandidate?.id || "unknown"}\` newTop=\`${summary.researchBoard.topNewCandidate?.id || "unknown"}\` status=\`${summary.researchBoard.topNewCandidate?.status || summary.researchBoard.topCandidate?.status || "unknown"}\` nextNew=\`${summary.researchBoard.nextNewAction?.code || "unknown"}\``,
    );
  }
  if (summary.secondaryStrategyScaffolds || summary.topAllocatorCandidate) {
    lines.push(
      `- Planning layers: scaffoldTop=\`${summary.topSecondaryScaffold?.id || summary.secondaryTopScaffoldId || summary.secondaryStrategyScaffolds?.topScaffold?.id || "unknown"}\` allocatorTop=\`${summary.topAllocatorCandidate?.id || summary.allocatorTopPlanningCandidateId || summary.allocatorCore?.topPlanningCandidate?.id || "unknown"}\``,
    );
  }
  if (summary.productCoverage) {
    lines.push(
      `- Product coverage: ready=${summary.productCoverage.readyCount ?? 0} inProgress=${summary.productCoverage.inProgressCount ?? 0} blocked=${summary.productCoverage.blockedCount ?? 0} missing=${summary.productCoverage.missingCount ?? 0} topGap=\`${summary.productCoverage.topGap?.id || "unknown"}\` reason=\`${summary.productCoverage.topGap?.reason || "unknown"}\``,
    );
  }
  if (summary.deterministicCandidates) {
    lines.push(
      `- Deterministic builds: candidates=${summary.deterministicCandidates.candidateCount ?? 0} readyForDryRun=${summary.deterministicCandidates.readyForDryRunCount ?? 0} receiptBacked=${summary.deterministicCandidates.receiptBackedCount ?? 0} top=\`${summary.deterministicCandidates.topCandidate?.id || "unknown"}\` next=\`${summary.deterministicCandidates.nextAction?.code || "unknown"}\``,
    );
  }
  if (effectivePhase3) {
    lines.push(
      `- Advanced validation lane: passed=${effectivePhase3.passedCount ?? 0}/${effectivePhase3.validationCount ?? 0} topBlocked=\`${phase3TopBlocked?.id || "unknown"}\` blockers=${phase3TopBlocked?.blockers?.slice(0, 3).join(",") || "none"} next=\`${phase3NextAction?.code || "unknown"}\``,
    );
  }
  if (summary.leverageAutoUnwindRuntime?.runtimeCount > 0) {
    lines.push(
      `- Auto-unwind runtime: count=${summary.leverageAutoUnwindRuntime.runtimeCount} top=\`${summary.leverageAutoUnwindRuntime.topPriority?.strategyId || "unknown"}\` status=\`${summary.leverageAutoUnwindRuntime.topPriority?.status || "unknown"}\` triggers=${summary.leverageAutoUnwindRuntime.topPriority?.triggers?.join(",") || "none"} next=\`${summary.leverageAutoUnwindRuntime.topPriority?.nextAction?.code || "unknown"}\``,
    );
  }
  if (summary.topAction?.code || summary.topAction?.command) {
    lines.push(`- Strategy next action: \`${summary.topAction?.code || "unknown"}\`${summary.topAction?.command ? ` command=\`${summary.topAction.command}\`` : ""}`);
  }
  if (summary.capitalExpansionReview) {
    if (Number.isFinite(summary.capitalExpansionReview.activeLaneBudgetUsd) || Number.isFinite(summary.capitalExpansionReview.planningLaneBudgetUsd)) {
      lines.push(
        `- Capital expansion: active=${money(summary.capitalExpansionReview.activeLaneBudgetUsd)} planning=${money(summary.capitalExpansionReview.planningLaneBudgetUsd)} planningTop=\`${summary.capitalExpansionReview.planningTopImplementedId || "unknown"}\`/\`${summary.capitalExpansionReview.planningTopPivotId || "unknown"}\` approvalRequired=${summary.capitalExpansionReview.approvalRequiredForPlanningLane}`,
      );
    }
  }
  lines.push(
    ...(snapshot?.implementedStrategies || [])
      .slice(0, 3)
      .map(
        (entry) =>
          `- Strategy lane: \`${entry.id || "unknown"}\` status=\`${entry.status || "unknown"}\`${entry.capitalGuidance?.minimumCapitalUsd ? ` floor=${money(entry.capitalGuidance.minimumCapitalUsd)}` : ""}`,
      ),
  );
  return lines;
}

function v1InfraDrillLines(summary = null) {
  if (!summary) return ["- V1 infra drills unavailable"];
  return [
    `- V1 infra drills: status=\`${summary.status || "unknown"}\` passed=${summary.passedCount ?? 0}/${summary.drillCount ?? 0}`,
    `- V1 next action: \`${summary.nextAction?.code || "unknown"}\`${summary.nextAction?.command ? ` command=\`${summary.nextAction.command}\`` : ""}`,
    summary.topFailedDrill
      ? `- V1 top failed drill: \`${summary.topFailedDrill.id || "unknown"}\` status=\`${summary.topFailedDrill.status || "unknown"}\``
      : "- V1 top failed drill: none",
  ];
}

function executionRunbookLines(summary = null, runbook = null) {
  if (!summary?.currentStageId && !runbook?.stages?.length) return ["- Execution runbook unavailable"];
  const lines = [
    `- Runbook: currentStage=\`${summary?.currentStageId || "unknown"}\` completed=${summary?.completeCount ?? 0}/${summary?.stageCount ?? runbook?.stages?.length ?? 0} blocked=${summary?.blockedCount ?? 0} reviewReady=${Boolean(summary?.readyForManualReview)}`,
  ];
  if (summary?.nextActionCode || summary?.nextActionCommand) {
    lines.push(`- Runbook next action: \`${summary.nextActionCode || "unknown"}\`${summary.nextActionCommand ? ` command=\`${summary.nextActionCommand}\`` : ""}`);
  }
  if (summary?.exactRouteForkPlanStatus || summary?.exactRouteForkPlanId) {
    lines.push(
      `- Exact-route fork plan: status=\`${summary.exactRouteForkPlanStatus || "unknown"}\` planId=\`${summary.exactRouteForkPlanId || "n/a"}\`${summary.exactRouteForkSubmitCommand ? ` submit=\`${summary.exactRouteForkSubmitCommand}\`` : ""}`,
    );
  }
  lines.push(
    ...((runbook?.stages || []).map(
      (stage) =>
        `- Stage: \`${stage.id}\` state=\`${stage.state || "unknown"}\` status=\`${stage.status || "unknown"}\` blockers=${stage.blockers?.slice(0, 3).join(",") || "none"}`,
    )),
  );
  return lines;
}

function preliveValidationLines(summary = null) {
  if (!summary?.validationStatus) return ["- Pre-live validation unavailable"];
  return [
    `- Validation: status=\`${summary.validationStatus}\` readiness=${summary.readinessPct ?? 0}% blockers=${summary.blockerCount ?? 0} warnings=${summary.warningCount ?? 0}`,
    `- Validation next step: stage=\`${summary.nextStageId || "unknown"}\` action=\`${summary.nextActionCode || "unknown"}\`${summary.nextActionCommand ? ` command=\`${summary.nextActionCommand}\`` : ""}`,
    `- Validation headline: topStrategy=\`${summary.topImplementedStrategyId || "unknown"}\` topPivot=\`${summary.topPivotId || "unknown"}\``,
  ];
}

function connectedRefreshLines(summary = null) {
  if (!summary?.status) return ["- Connected refresh package unavailable"];
  return [
    `- Connected refresh: status=\`${summary.status}\` route=\`${summary.routeLabel || summary.routeKey || "unknown"}\` amount=\`${summary.amount || "n/a"}\` required=${summary.requiredRefreshCount ?? 0}`,
    `- Refresh next step: action=\`${summary.nextActionCode || "unknown"}\`${summary.nextActionCommand ? ` command=\`${summary.nextActionCommand}\`` : ""}`,
    `- Refresh runner: preview=\`${summary.runnerPreviewCommand || "n/a"}\` execute=\`${summary.runnerExecuteCommand || "n/a"}\``,
    `- Refresh chain: ${summary.fullCommandChain ? `\`${summary.fullCommandChain}\`` : "n/a"}`,
  ];
}

function connectedRefreshExecutionLines(summary = null) {
  if (!summary) return ["- Connected refresh execution summary unavailable"];
  return [
    `- Refresh execution: runs=${summary.runCount ?? 0} preview=${summary.previewCount ?? 0} success=${summary.successCount ?? 0} partial=${summary.partialCount ?? 0} failed=${summary.failureCount ?? 0} latest=\`${summary.latestStatus || "none"}\``,
    `- Refresh execution next: action=\`${summary.nextAction?.code || "unknown"}\`${summary.nextAction?.command ? ` command=\`${summary.nextAction.command}\`` : ""}`,
  ];
}

function currentRoutePrelivePassLines(summary = null) {
  if (!summary) return ["- Current-route pre-live pass summary unavailable"];
  return [
    `- Current-route pre-live pass: runs=${summary.runCount ?? 0} preview=${summary.previewCount ?? 0} readyForSigner=${summary.readyForSignerCount ?? 0} blocked=${summary.blockedCount ?? 0} partial=${summary.partialCount ?? 0} failed=${summary.failureCount ?? 0} latest=\`${summary.latestStatus || "none"}\``,
    `- Current-route pass next: action=\`${summary.nextAction?.code || "unknown"}\`${summary.nextAction?.command ? ` command=\`${summary.nextAction.command}\`` : ""}`,
  ];
}

function exactRouteForkPackageLines(summary = null) {
  if (!summary?.status) return ["- Exact-route fork package unavailable"];
  return [
    `- Exact-route fork package: status=\`${summary.status}\` planId=\`${summary.planId || "n/a"}\` route=\`${summary.routeLabel || summary.routeKey || "unknown"}\` amount=\`${summary.amount || "n/a"}\``,
    `- Fork readiness split: technical=\`${summary.technicalStatus || "unknown"}\` economic=\`${summary.economicStatus || "unknown"}\``,
    `- Fork evidence: simulation=${summary.simulationSuccessCount ?? 0}/${summary.simulationTargetCount ?? 0} fork=${summary.forkConfirmedCount ?? 0}/${summary.forkTargetCount ?? 0}`,
    `- Fork next step: action=\`${summary.nextActionCode || "unknown"}\`${summary.nextActionCommand ? ` command=\`${summary.nextActionCommand}\`` : ""}`,
  ];
}

function operationalJudgmentLines(summary = null, review = null) {
  if (!summary?.status) return ["- Operational judgment review unavailable"];
  const lines = [
    `- Operational judgment: status=\`${summary.status}\` issues=${summary.issueCount ?? 0} high=${summary.highSeverityCount ?? 0} medium=${summary.mediumSeverityCount ?? 0}`,
    `- Judgment next step: action=\`${summary.nextActionCode || "unknown"}\`${summary.nextActionCommand ? ` command=\`${summary.nextActionCommand}\`` : ""}`,
  ];
  lines.push(
    ...((review?.issues || []).slice(0, 3).map(
      (entry) => `- Judgment issue: \`${entry.code}\` severity=\`${entry.severity}\` headline=${entry.headline}`,
    )),
  );
  return lines;
}

function onePageExecutionBriefLines({
  dashboardStatus = null,
  next = null,
  best = null,
  address = null,
  pivotPlan = null,
  yieldShadow = null,
  proxyCoverage = null,
  strategySnapshot = null,
  phase3StrategyValidation = null,
  executionRunbook = null,
  preliveValidation = null,
  connectedRefreshPackage = null,
  connectedRefreshExecution = null,
  exactRouteForkPackage = null,
  operationalJudgmentReview = null,
  wholeWalletFunding = null,
} = {}) {
  const yieldTop = yieldShadow?.topProfile || null;
  const pivotTop = pivotPlan?.topRecommendation || null;
  const pilot = yieldShadow?.profiles?.find((item) => item.id === "research_pilot") || null;
  const diversified = yieldShadow?.profiles?.find((item) => item.id === "diversified_single_sleeve") || null;
  const defaultSplit = yieldShadow?.profiles?.find((item) => item.id === "default_dual_sleeve") || null;
  const activeBudget = pivotPlan?.budgetScenarios?.find((scenario) => !scenario.planningOnly) || null;
  const expansionBudget = pivotPlan?.budgetScenarios?.find((scenario) => scenario.planningOnly) || null;
  const liveBaselineSummary = buildLiveBaselineSummary({
    dashboardStatus: {
      ...dashboardStatus,
      prelive: {
        ...(dashboardStatus?.prelive || {}),
        connectedRefresh: connectedRefreshPackage || dashboardStatus?.prelive?.connectedRefresh || null,
        currentRoutePrelivePass:
          dashboardStatus?.prelive?.currentRoutePrelivePass || null,
        exactRouteForkPackage: exactRouteForkPackage || dashboardStatus?.prelive?.exactRouteForkPackage || null,
        operationalJudgmentReview:
          operationalJudgmentReview || dashboardStatus?.prelive?.operationalJudgmentReview || null,
        validation: preliveValidation || dashboardStatus?.prelive?.validation || null,
      },
    },
    nextStep: next,
  });
  const defaultSplitExpansionFit =
    defaultSplit?.budgetScenarios?.find((scenario) => scenario.budgetUsd === expansionBudget?.budgetUsd)?.fitsBudget ?? null;
  const exactGasCommand =
    best?.routeKey && best?.amount && address
      ? `npm run estimate:gateway-gas -- --from="${address}" --route-key="${best.routeKey}" --amount="${best.amount}"`
      : null;
  const payback = dashboardStatus?.payback || null;
  const effectivePhase3 = strategySnapshot?.phase3StrategyValidation || phase3StrategyValidation || null;
  const phase3TopBlocked = effectivePhase3?.topBlocked || null;
  const phase3NextAction = effectivePhase3?.nextAction || null;
  const formulaAudit = buildFormulaAudit();
  const lines = [
    `- Status: live=\`${dashboardStatus?.overall?.liveTrading || "BLOCKED"}\` shadow=\`${dashboardStatus?.overall?.shadowTrading || "ALLOWED"}\` next=\`${next?.decision || "unknown"}\``,
    `- Strategy pack: implemented=${strategySnapshot?.implementedStrategyCount ?? 0} top=\`${strategySnapshot?.topImplementedStrategy?.id || "unknown"}\` pivot=\`${strategySnapshot?.topPivot?.id || "unknown"}\``,
    `- Catalog scope: \`${strategySnapshot?.catalogScope?.coverage || "unknown"}\` scaffoldTop=\`${strategySnapshot?.topSecondaryScaffold?.id || strategySnapshot?.secondaryTopScaffoldId || strategySnapshot?.secondaryStrategyScaffolds?.topScaffold?.id || "unknown"}\` allocatorTop=\`${strategySnapshot?.topAllocatorCandidate?.id || strategySnapshot?.allocatorTopPlanningCandidateId || strategySnapshot?.allocatorCore?.topPlanningCandidate?.id || "unknown"}\``,
    `- Product coverage: ready=${strategySnapshot?.productCoverage?.readyCount ?? 0} inProgress=${strategySnapshot?.productCoverage?.inProgressCount ?? 0} blocked=${strategySnapshot?.productCoverage?.blockedCount ?? 0} missing=${strategySnapshot?.productCoverage?.missingCount ?? 0} topGap=\`${strategySnapshot?.productCoverage?.topGap?.id || "unknown"}\` reason=\`${strategySnapshot?.productCoverage?.topGap?.reason || "unknown"}\``,
    `- Formula audit: implemented=${formulaAudit.summary.implementedCount} partial=${formulaAudit.summary.partialCount} missing=${formulaAudit.summary.missingCount} topGap=\`${formulaAudit.summary.topGap?.id || "unknown"}\``,
    `- Research board: candidates=${strategySnapshot?.researchBoard?.candidateCount ?? 0} top=\`${strategySnapshot?.researchBoard?.topCandidate?.id || "unknown"}\` newTop=\`${strategySnapshot?.researchBoard?.topNewCandidate?.id || "unknown"}\` nextNew=\`${strategySnapshot?.researchBoard?.nextNewAction?.code || "unknown"}\``,
    `- Deterministic builds: candidates=${strategySnapshot?.deterministicCandidates?.candidateCount ?? 0} readyForDryRun=${strategySnapshot?.deterministicCandidates?.readyForDryRunCount ?? 0} top=\`${strategySnapshot?.deterministicCandidates?.topCandidate?.id || "unknown"}\` next=\`${strategySnapshot?.deterministicCandidates?.nextAction?.code || "unknown"}\``,
    `- Advanced validation lane: passed=${effectivePhase3?.passedCount ?? 0}/${effectivePhase3?.validationCount ?? 0} topBlocked=\`${phase3TopBlocked?.id || "unknown"}\` blockers=${phase3TopBlocked?.blockers?.slice(0, 3).join(",") || "none"} next=\`${phase3NextAction?.code || "unknown"}\``,
    `- Pivot headline: \`${pivotTop?.id || "unknown"}\` capital pilot=${money(yieldTop?.capitalRequiredUsd)} next=\`${yieldTop?.nextActionCode || pivotTop?.nextActionCode || "unknown"}\``,
    `- Capital mode: per_strategy_caps${Number.isFinite(expansionBudget?.budgetUsd) ? ` referenceCap=${money(expansionBudget?.budgetUsd)}` : ""} defaultYieldFitsReference=${
      defaultSplitExpansionFit === true ? "yes" : defaultSplitExpansionFit === false ? "no" : "n/a"
    }`,
    `- Yield paper lanes: pilot=${money(pilot?.capitalRequiredUsd)} diversified=${money(diversified?.capitalRequiredUsd)} default=${money(defaultSplit?.capitalRequiredUsd)}`,
  ];
  lines.push(
    `- Proxy lane: proxy=\`${proxyCoverage?.nextProxyGroup || "unknown"}\` action=\`${proxyCoverage?.nextAction || "unknown"}\` quota=${proxyCoverage?.nextQuoteQuotaNeeded ?? 0}`,
  );
  lines.push(
    best?.routeKey
      ? `- Canary lane: route=\`${best.label || best.routeKey}\` amount=\`${best.amount || "n/a"}\`${exactGasCommand ? ` exactGas=\`${exactGasCommand}\`` : ""}`
      : "- Canary lane: no active route",
  );
  if (wholeWalletFunding?.status === "route_funding_required") {
    const tokenTop = wholeWalletFunding.recommendations?.tokenTopUps?.[0] || null;
    const nativeTop = wholeWalletFunding.recommendations?.nativeTopUps?.[0] || null;
    lines.push(
      `- Whole-wallet funding: route=\`${wholeWalletFunding.routeKey}\` nativeGap=${money(wholeWalletFunding.readiness?.nativeShortfallUsd)} tokenGap=\`${wholeWalletFunding.readiness?.tokenShortfall || "0"}\` topToken=\`${tokenTop ? `${tokenTop.chain} ${tokenTop.ticker}` : "none"}\` topNative=\`${nativeTop ? `${nativeTop.chain} ${nativeTop.ticker}` : "none"}\``,
    );
    if (wholeWalletFunding.livePreview?.tokenProbe || wholeWalletFunding.livePreview?.nativeProbe) {
      const tokenProbe = wholeWalletFunding.livePreview?.tokenProbe;
      const nativeProbe = wholeWalletFunding.livePreview?.nativeProbe;
      lines.push(
        `- Whole-wallet probe: token=${tokenProbe ? `${tokenProbe.status}/${tokenProbe.blockedReason || "ok"}/covers=${tokenProbe.coversShortfall}` : "n/a"} native=${nativeProbe ? `${nativeProbe.status}/${nativeProbe.blockedReason || "ok"}/covers=${nativeProbe.coversShortfall}` : "n/a"}`,
      );
    }
  }
  lines.push(
    `- Validation: status=\`${preliveValidation?.validationStatus || "unknown"}\` nextStage=\`${executionRunbook?.nextStageId || "unknown"}\` nextAction=\`${preliveValidation?.nextActionCode || executionRunbook?.nextActionCode || "unknown"}\``,
  );
  if (liveBaselineSummary) {
    lines.push(
      `- Live baseline: stage=\`${liveBaselineSummary.currentStageId || "none"}\` refreshInputs=${liveBaselineSummary.counts?.requiredRefreshCount ?? 0} operator=${liveBaselineSummary.counts?.operator ?? 0} technical=${liveBaselineSummary.counts?.technical ?? 0} objective=${liveBaselineSummary.counts?.objective ?? 0} next=\`${liveBaselineSummary.nextAction?.code || "none"}\``,
    );
  }
  if (payback) {
    const minimumProgress = minimumPaybackProgress(payback);
    lines.push(
      `- Payback: scheduler=\`${payback.scheduler?.status || "unknown"}\` reason=\`${payback.scheduler?.reason || "unknown"}\` pending=\`${formatSats(payback.accumulatorPendingSats)}\` next=\`${payback.scheduler?.nextAction || "none"}\``,
    );
    if (minimumProgress) {
      const label = minimumProgress.source === "current" ? "Payback minimum gap" : "Payback after destination";
      lines.push(
        `- ${label}: \`${minimumProgress.status || "unknown"}\` reason=\`${minimumProgress.reason || "unknown"}\` grossTarget=\`${formatSats(minimumProgress.grossTargetBeforeCostsSats)}\` min=\`${formatSats(minimumProgress.minPaybackSats)}\` remaining=\`${formatSats(minimumProgress.satsToMinimumPayback)}\` progress=\`${formatRatio(minimumProgress.progressToMinimumRatio)}\``,
      );
    }
  }
  if (connectedRefreshPackage?.status) {
    lines.push(
      `- Connected refresh: status=\`${connectedRefreshPackage.status}\` required=${connectedRefreshPackage.requiredRefreshCount ?? 0} next=\`${connectedRefreshPackage.nextActionCode || "unknown"}\``,
    );
  }
  if (connectedRefreshExecution) {
    lines.push(
      `- Refresh runner state: runs=${connectedRefreshExecution.runCount ?? 0} preview=${connectedRefreshExecution.previewCount ?? 0} latest=\`${connectedRefreshExecution.latestStatus || "none"}\` remaining=${connectedRefreshExecution.remainingRefreshCount ?? "n/a"}`,
    );
  }
  if (dashboardStatus?.prelive?.v1InfraDrills) {
    lines.push(
      `- V1 infra drills: status=\`${dashboardStatus.prelive.v1InfraDrills.status || "unknown"}\` passed=${dashboardStatus.prelive.v1InfraDrills.passedCount ?? 0}/${dashboardStatus.prelive.v1InfraDrills.drillCount ?? 0} next=\`${dashboardStatus.prelive.v1InfraDrills.nextAction?.code || "unknown"}\``,
    );
  }
  lines.push(`- Connected pre-live pass: \`npm run run:current-route-prelive-pass -- --execute\``);
  lines.push(`- Current-route pass report: \`npm run report:current-route-prelive-pass -- --write\``);
  if (executionRunbook?.exactRouteForkPlanStatus || executionRunbook?.exactRouteForkPlanId) {
    lines.push(
      `- Fork prep: exactPlan=\`${executionRunbook?.exactRouteForkPlanStatus || "unknown"}\` planId=\`${executionRunbook?.exactRouteForkPlanId || "n/a"}\``,
    );
  }
  if (exactRouteForkPackage?.status) {
    lines.push(
      `- Exact-route fork split: status=\`${exactRouteForkPackage.status}\` technical=\`${exactRouteForkPackage.technicalStatus || "unknown"}\` economic=\`${exactRouteForkPackage.economicStatus || "unknown"}\``,
    );
  }
  if (operationalJudgmentReview?.status) {
    lines.push(
      `- Judgment review: status=\`${operationalJudgmentReview.status}\` issues=${operationalJudgmentReview.issueCount ?? 0} high=${operationalJudgmentReview.highSeverityCount ?? 0}`,
    );
  }
  lines.push("- Safe local command order:");
  lines.push("-   1) `npm run report:strategy-snapshot -- --write`");
  lines.push("-   2) `npm run report:connected-refresh-package -- --write`");
  lines.push("-   3) `npm run report:execution-runbook -- --write`");
  lines.push("-   4) `npm run report:exact-route-fork-package -- --write`");
  lines.push("-   5) `npm run validate:prelive-readiness -- --write`");
  lines.push("-   6) `npm run report:operational-judgment-review -- --write`");
  lines.push("-   7) `npm run report:yield-shadow-book -- --write && npm run report:proxy-spread-coverage -- --write`");
  lines.push("-   8) `npm run audit:overfit && npm run score:gateway -- --write && npm run status:dashboard`");
  lines.push("-   9) `npm run report:payback-status -- --json`");
  lines.push("-   10) `npm run write:session-handoff`");
  if (proxyCoverage?.nextCommand) {
    lines.push(`- Networked operator runtime only: \`${proxyCoverage.nextCommand}\``);
  }
  lines.push("- Decision lock: keep live execution blocked; treat all new samples as research until policy and anti-overfit gates clear.");
  return lines;
}

function checklistLines(checklist) {
  return [
    `- Completed so far: ${checklist?.completed?.join(" · ") || "none yet"}`,
    `- Remaining steps: ${checklist?.remaining?.join(" · ") || "none"}`,
  ];
}

function executionStageLines(summary) {
  return [
    `- Manual canary review: ${summary.reviewStage}${summary.reviewReasons.length ? ` (${summary.reviewReasons.join(",")})` : ""}`,
    `- Live execution: ${summary.liveStage}${summary.auditDecision ? `; audit=${summary.auditDecision}` : ""}${summary.liveReasons.length ? ` (${summary.liveReasons.join(",")})` : ""}`,
  ];
}

function stableRouteCandidates(scores = []) {
  return scores
    .filter((score) => score?.srcAsset?.family === "stablecoin" || score?.dstAsset?.family === "stablecoin")
    .sort(
      (left, right) =>
        (right.executableNetEdgeUsd ?? right.netEdgeUsd ?? Number.NEGATIVE_INFINITY) -
          (left.executableNetEdgeUsd ?? left.netEdgeUsd ?? Number.NEGATIVE_INFINITY) ||
        String(left.routeKey).localeCompare(String(right.routeKey)),
    );
}

function strategyLines(
  scores = [],
  shadowObservations = [],
  dexQuotes = [],
  routes = [],
  routesObservedAt = null,
  quotes = [],
  routePlan = null,
  canaryInputs = null,
  address = null,
  ethProfitability = null,
) {
  const bestStable = stableRouteCandidates(scores)[0] || null;
  const btcProxySpreads = buildBtcProxySpreadSummary({ dexQuotes, routes, scoreSnapshot: { scores } });
  const crossAsset = buildCrossAssetArbitrageSummary({ scores });
  const dexEnvironment = buildDexEnvironmentSummary({ dexQuotes });
  const dexRouteFocus = buildDexRouteFocusSummary({ routes, quotes, scoreSnapshot: { scores }, dexQuotes });
  const dexGateway = buildDexGatewayArbitrageSummary({ scoreSnapshot: { scores }, dexQuotes });
  const dexRouteUniverse = buildDexRouteUniverseSummary({ routes, observedAt: routesObservedAt });
  const edgeViability = buildEdgeViabilitySummary({ scoreSnapshot: { scores }, dexQuotes });
  const edgeViabilityVerdict = buildEdgeViabilityVerdict({ edgeViability, dexRouteFocus });
  const edgeResearch = buildEdgeResearchSummary({ scoreSnapshot: { scores }, shadowObservations });
  const noEdgePersistence = buildNoEdgePersistenceSummary({ scoreSnapshot: { scores }, dexQuotes });
  const objectivePlans = buildObjectivePlans({
    routePlan,
    canaryInputs,
    scoreSnapshot: { scores },
    shadowObservations,
    dexQuotes,
    address,
  });
  const strategyTracks = buildStrategyTracksSummary({
    shadowCycle: { topRoute: null, shadowActions: [] },
    bestStablecoinRoute: bestStable,
    crossAssetArbitrage: crossAsset,
    btcProxySpreads,
    ethProfitability,
  });
  const strategyPlans = buildStrategyRefreshPlans({
    crossAssetArbitrage: crossAsset,
    btcProxySpreads,
  });
  return [
    "- Strategy note: BTC-family transfer by itself is usually loss-making after Gateway fee, gas, and slippage.",
    "- Strategy note: the actionable target is a local executable BTC/stable dislocation that beats total movement cost.",
    "- Strategy note: BTC accumulation from a long-term bullish view is directional inventory exposure, not arbitrage profit, so it must not unlock canary or live execution by itself.",
    `- Strong-edge research: definite=${edgeResearch.definiteEdgeCandidateCount} multiLevel=${edgeResearch.multiLevelCandidateCount} missingDecay=${edgeResearch.missingDecayCoverageCount + edgeResearch.missingDecaySurvivalCount} singleLevel=${edgeResearch.singleLevelOnlyCount} noEdge=${edgeResearch.noEdgeCount} outliers=${edgeResearch.outlierCount}`,
    `- DEX route universe: btcFamily=${dexRouteUniverse.btcFamilyRouteCount} fullyMeasurable=${dexRouteUniverse.fullyMeasurableRouteCount} singleGap=${dexRouteUniverse.singleProviderGapCount} doubleGap=${dexRouteUniverse.doubleProviderGapCount}`,
    `- DEX focus shortlist: loopObservable=${dexRouteFocus.loopObservableCount} partial=${dexRouteFocus.partialLoopMeasurementCount} missingGatewayQuote=${dexRouteFocus.missingGatewayQuoteCount}`,
    `- Edge viability: measured=${edgeViability.measuredLoopCount} positive=${edgeViability.positiveMeasuredCount} policyReady=${edgeViability.policyReadyCount} medianGap=${money(edgeViability.medianGapToPolicyUsd)}`,
    `- Edge verdict: ${edgeViabilityVerdict.label}${edgeViabilityVerdict.detail ? ` (${edgeViabilityVerdict.detail})` : ""}`,
    `- No-edge persistence: durable=${noEdgePersistence.durableNoEdgeRouteCount} belowPolicy=${noEdgePersistence.belowPolicyRouteCount} nearPolicy=${noEdgePersistence.nearPolicyRouteCount} positiveBelow=${noEdgePersistence.positiveButBelowPolicyRouteCount}`,
    dexRouteUniverse.topGapChain
      ? `- Largest DEX coverage gap chain: \`${dexRouteUniverse.topGapChain.chain}\` routeCount=${dexRouteUniverse.topGapChain.routeCount}`
      : "- Largest DEX coverage gap chain: none observed",
    dexRouteFocus.bestRoute
      ? `- Best DEX focus route now: \`${dexRouteFocus.bestRoute.routeKey}\` class=\`${dexRouteFocus.bestRoute.classification}\` gatewayQuotes=${dexRouteFocus.bestRoute.gatewayQuoteCount} entryQuotes=${dexRouteFocus.bestRoute.entryQuoteCount} exitQuotes=${dexRouteFocus.bestRoute.exitQuoteCount} bestExec=${money(dexRouteFocus.bestRoute.bestExecutableNetEdgeUsd)}`
      : "- Best DEX focus route now: none observed",
    `- DEX environment drift: monitored=${dexEnvironment.monitoredRouteCount} staleLegs=${dexEnvironment.staleLegCount} unstableLegs=${dexEnvironment.unstableLegCount} thinLiquidityLegs=${dexEnvironment.thinLiquidityLegCount} singleSampleLegs=${dexEnvironment.singleSampleLegCount}`,
    dexEnvironment.topRiskRoute
      ? `- Top DEX environment risk: \`${dexEnvironment.topRiskRoute.routeKey}\` amount=\`${dexEnvironment.topRiskRoute.amount}\` class=\`${dexEnvironment.topRiskRoute.classification}\` staleLegs=${dexEnvironment.topRiskRoute.staleLegCount} unstableLegs=${dexEnvironment.topRiskRoute.unstableLegCount} thinLiquidityLegs=${dexEnvironment.topRiskRoute.thinLiquidityLegCount} singleSampleLegs=${dexEnvironment.topRiskRoute.singleSampleLegCount}`
      : "- Top DEX environment risk: none observed",
    edgeResearch.bestCandidate
      ? `- Best research route now: \`${edgeResearch.bestCandidate.routeKey}\` class=\`${edgeResearch.bestCandidate.classification}\` profitableLevels=${edgeResearch.bestCandidate.profitableLevels}/${edgeResearch.bestCandidate.amountLevels} bestNet=${money(edgeResearch.bestCandidate.bestNetEdgeUsd)}`
      : "- Best research route now: none observed",
    `- Measured DEX+Gateway coverage: bothDexSupported=${dexGateway.bothDexSupportedRouteCount} executable=${dexGateway.executableLoopCount} measuredNet=${dexGateway.measuredNetLoopCount} exact=${dexGateway.exactAmountMatchCount} profitable=${dexGateway.profitableExactCount}`,
    edgeViability.closestLoop
      ? `- Closest route to policy gate: \`${edgeViability.closestLoop.routeKey}\` amount=\`${edgeViability.closestLoop.amount}\` net=${money(edgeViability.closestLoop.measuredLoopNetUsd)} gapToPolicy=${money(edgeViability.closestLoop.gapToPolicyUsd)} target=${money(edgeViability.closestLoop.requiredNetProfitUsd)}`
      : "- Closest route to policy gate: none observed",
    noEdgePersistence.bestRoute
      ? `- Best persistence route now: \`${noEdgePersistence.bestRoute.routeKey}\` class=\`${noEdgePersistence.bestRoute.classification}\` measuredLevels=${noEdgePersistence.bestRoute.measuredLevelCount} minGap=${money(noEdgePersistence.bestRoute.minGapToPolicyUsd)} bestNet=${money(noEdgePersistence.bestRoute.bestMeasuredLoopNetUsd)}`
      : "- Best persistence route now: none observed",
    dexGateway.bestLoop
      ? `- Best measured DEX+Gateway loop: \`${dexGateway.bestLoop.routeKey}\` netEdge=${money(dexGateway.bestLoop.measuredLoopNetUsd)} amountGap=${((dexGateway.bestLoop.amountGapPct || 0) * 100).toFixed(2)}%`
      : dexGateway.closestLoop
        ? `- Closest measured DEX+Gateway loop: \`${dexGateway.closestLoop.routeKey}\` netEdge=${money(dexGateway.closestLoop.measuredLoopNetUsd)} amountGap=${((dexGateway.closestLoop.amountGapPct || 0) * 100).toFixed(2)}% blockers=${dexGateway.closestLoop.blockers.join(",") || "none"}`
        : "- Best measured DEX+Gateway loop: none observed",
    bestStable
      ? `- Best stablecoin-related route now: \`${bestStable.routeKey}\` amount=\`${bestStable.amount}\` readiness=\`${bestStable.tradeReadiness}\` netEdge=${money(bestStable.executableNetEdgeUsd ?? bestStable.netEdgeUsd)}`
      : "- Best stablecoin-related route now: none observed",
    crossAsset.bestLoop
      ? `- Best closed stable->BTC->stable loop: \`${crossAsset.bestLoop.entryRouteKey}\` + \`${crossAsset.bestLoop.exitRouteKey}\` netEdge=${money(crossAsset.bestLoop.loopNetEdgeUsd)}`
      : "- Best closed stable->BTC->stable loop: none matched yet",
    crossAsset.bestAmountLadderPair
      ? `- Stable amount ladder: pair=\`${crossAsset.bestAmountLadderPair.entryRouteKey}\` + \`${crossAsset.bestAmountLadderPair.exitRouteKey}\` entryLevels=${crossAsset.bestAmountLadderPair.entryAmountLevelCount} exitLevels=${crossAsset.bestAmountLadderPair.exitAmountLevelCount} exact=${crossAsset.bestAmountLadderPair.exactMatchCount} closestGap=${Number.isFinite(crossAsset.bestAmountLadderPair.closestAmountGapPct) ? `${(crossAsset.bestAmountLadderPair.closestAmountGapPct * 100).toFixed(2)}%` : "n/a"}`
      : "- Stable amount ladder: no paired stable/BTC ladder yet",
    crossAsset.closestLoop && !crossAsset.bestLoop
      ? `- Closest loop blocker: amount gap ${(crossAsset.closestLoop.amountGapPct * 100).toFixed(2)}% on \`${crossAsset.closestLoop.entryRouteKey}\` + \`${crossAsset.closestLoop.exitRouteKey}\``
      : null,
    `- Proxy spread surface: buyQuotes=${btcProxySpreads.buyQuoteCount} sellQuotes=${btcProxySpreads.sellQuoteCount} opportunities=${btcProxySpreads.opportunityCount} policyReady=${btcProxySpreads.policyReadyCount} overfit=${btcProxySpreads.overfitAssessment}`,
    btcProxySpreads.nextCoverageTarget
      ? `- Proxy coverage target: group=\`${btcProxySpreads.nextCoverageTarget.proxyGroup}\` next=\`${btcProxySpreads.nextCoverageTarget.nextAction}\` reason=\`${btcProxySpreads.nextCoverageTarget.reason}\` buyLevels=${btcProxySpreads.nextCoverageTarget.buyAmountLevelCount} sellLevels=${btcProxySpreads.nextCoverageTarget.sellAmountLevelCount} matchedLevels=${btcProxySpreads.nextCoverageTarget.matchedAmountLevelCount}`
      : "- Proxy coverage target: none",
    strategyPlans.stableLoop?.command
      ? `- Stable loop refresh command: \`${strategyPlans.stableLoop.command}\``
      : null,
    strategyPlans.proxySpread?.command
      ? `- Proxy spread refresh command: \`${strategyPlans.proxySpread.command}\``
      : null,
    objectivePlans.discovery
      ? `- Objective discovery plan: route=\`${objectivePlans.discovery.label || objectivePlans.discovery.routeKey}\` amount=\`${objectivePlans.discovery.amount}\` next=\`${objectivePlans.discovery.nextActionCode}\` reason=\`${objectivePlans.discovery.reason}\``
      : null,
    ...strategyTracks.tracks
      .filter((item) => item.kind === "stable_loop" || item.kind === "proxy_spread" || item.kind === "eth_family_loop")
      .map((item) => `- Strategy track ${item.kind}: label=\`${item.label || "none"}\` status=\`${item.status}\` next=\`${item.nextActionCode}\` reason=\`${item.reason || "none"}\`${item.command ? ` command=\`${item.command}\`` : ""}`),
  ];
}

function profitabilityLines(summary) {
  if (!summary) return ["- Profitability summary unavailable"];
  const reviewPlan = summary.canarySelectionGap?.reviewPlan || null;
  const reviewCommands = reviewPlan
    ? [
        reviewPlan.actionCodes.includes("check_wallet_readiness")
          ? `npm run check:estimator-wallet -- --route-key="${reviewPlan.routeKey}" --amount="${reviewPlan.amount}"`
          : null,
        reviewPlan.actionCodes.includes("refresh_exact_gas")
          ? `npm run estimate:gateway-gas -- --route-key="${reviewPlan.routeKey}" --amount="${reviewPlan.amount}"`
          : null,
        reviewPlan.actionCodes.includes("refresh_dex_quote")
          ? `npm run quote:dex -- --route-key="${reviewPlan.routeKey}" --amount="${reviewPlan.amount}"`
          : null,
        reviewPlan.actionCodes.includes("refresh_market_snapshot")
          ? "npm run price:snapshot"
          : null,
        reviewPlan.actionCodes.includes("rerun_route_scoring")
          ? `npm run score:gateway -- --write --route-key="${reviewPlan.routeKey}" --amount="${reviewPlan.amount}"`
          : null,
        reviewPlan.actionCodes.includes("refresh_public_status")
          ? "npm run status:dashboard"
          : null,
      ].filter(Boolean)
    : [];
  return [
    `- Tested closed loops: ${summary.measuredClosedLoopCount}`,
    `- Profitable closed loops: ${summary.profitableClosedLoopCount}`,
    `- Loop-observable routes: ${summary.loopObservableRouteCount}`,
    `- Missing focus Gateway quotes: ${summary.missingGatewayQuoteCount}`,
    `- Profit verdict: ${summary.verdictLabel || "unknown"}${summary.verdictDetail ? ` (${summary.verdictDetail})` : ""}`,
    summary.canaryTradeReadiness
      ? `- Current canary route: ${summary.canaryTradeReadiness}${Number.isFinite(summary.canaryNetEdgeUsd) ? ` net=${money(summary.canaryNetEdgeUsd)}` : ""}`
      : "- Current canary route: unavailable",
    summary.closestPolicyRoute
      ? `- Closest route to policy: \`${summary.closestPolicyRoute.routeKey}\` amount=\`${summary.closestPolicyRoute.amount}\` net=${money(summary.closestPolicyRoute.netUsd)} gap=${money(summary.closestPolicyRoute.gapToPolicyUsd)} target=${money(summary.closestPolicyRoute.targetUsd)}`
      : "- Closest route to policy: none observed",
    summary.bestStablecoinRoute
      ? `- Best stablecoin route tested: \`${summary.bestStablecoinRoute.routeKey}\` amount=\`${summary.bestStablecoinRoute.amount}\` readiness=\`${summary.bestStablecoinRoute.tradeReadiness}\` net=${money(summary.bestStablecoinRoute.netUsd)}`
      : "- Best stablecoin route tested: none observed",
    summary.ethFamily
      ? `- ETH-family routes: ${summary.ethFamily.routeCount} family / ${summary.ethFamily.gatewayRouteCount} ETH-related gateway routes; measurable=${summary.ethFamily.fullyMeasurableRouteCount} loopObservable=${summary.ethFamily.loopObservableRouteCount} stable=${summary.ethFamily.stableRouteCount}`
      : null,
    summary.ethFamily
      ? `- ETH-family loops: measured=${summary.ethFamily.measuredClosedLoopCount} profitable=${summary.ethFamily.profitableClosedLoopCount} policyBlocked=${summary.ethFamily.policyBlockedCount}`
      : null,
    summary.ethFamily
      ? `- ETH-family loop verdict: ${summary.ethFamily.verdictLabel || "unknown"}${summary.ethFamily.verdictDetail ? ` (${summary.ethFamily.verdictDetail})` : ""}`
      : null,
    summary.ethFamily
      ? `- ETH-family recommendation: ${summary.ethFamily.recommendationLabel || "unknown"}${summary.ethFamily.recommendationDetail ? ` (${summary.ethFamily.recommendationDetail})` : ""}`
      : null,
    summary.ethFamily?.closestPolicyRoute
      ? `- Closest ETH-family route to policy: \`${summary.ethFamily.closestPolicyRoute.routeKey}\` amount=\`${summary.ethFamily.closestPolicyRoute.amount}\` net=${money(summary.ethFamily.closestPolicyRoute.netUsd)} gap=${money(summary.ethFamily.closestPolicyRoute.gapToPolicyUsd)} target=${money(summary.ethFamily.closestPolicyRoute.targetUsd)}`
      : "- Closest ETH-family route to policy: none observed",
    summary.ethFamily?.bestResearchRoute
      ? `- Best ETH-family research route: \`${summary.ethFamily.bestResearchRoute.routeKey}\` class=\`${summary.ethFamily.bestResearchRoute.classification || "unknown"}\` readiness=\`${summary.ethFamily.bestResearchRoute.tradeReadiness || "unknown"}\` net=${money(summary.ethFamily.bestResearchRoute.netUsd)}`
      : "- Best ETH-family research route: none observed",
    summary.ethFamily?.followUpActionCode
      ? `- ETH-family next action: \`${summary.ethFamily.followUpActionCode}\`${summary.ethFamily.followUpCommand ? ` command=\`${summary.ethFamily.followUpCommand}\`` : ""}`
      : null,
    summary.ethFamily
      ? `- ETH-family overfit risks: ${summary.ethFamily.overfitRisks.join(",") || "none"}`
      : null,
    summary.canarySelectionGap
      ? `- Measured leader under review: \`${summary.canarySelectionGap.measuredLeader.routeKey}\` amount=\`${summary.canarySelectionGap.measuredLeader.amount}\` measured=${money(summary.canarySelectionGap.measuredLeader.measuredNetUsd)} readiness=\`${summary.canarySelectionGap.measuredLeader.tradeReadiness || "unknown"}\``
      : null,
    summary.canarySelectionGap
      ? `- Why it is not the canary: ${summary.canarySelectionGap.reasonLabels.join("; ")}${summary.canarySelectionGap.blockerLabels.length ? ` | blockers: ${summary.canarySelectionGap.blockerLabels.join(", ")}` : ""}`
      : null,
    reviewPlan?.actionLabels?.length
      ? `- Revalidation order for measured leader: ${reviewPlan.actionLabels.join(" -> ")}`
      : null,
    reviewCommands.length
      ? `- Revalidation commands: ${reviewCommands.join(" && ")}`
      : null,
    summary.canarySelectionGap?.hypothesisGuard
      ? `- Hypothesis guard: ${summary.canarySelectionGap.hypothesisGuard}`
      : null,
    `- Durable no-edge routes: ${summary.durableNoEdgeRouteCount}`,
  ];
}

async function main() {
  const now = new Date().toISOString();
  const resolved = await resolveOperationalAddress({ dataDir: config.dataDir });
  const state = await loadCanaryState({
    address: resolved.address,
    dataDir: config.dataDir,
  });
  const quoteFailures = await readJsonl(config.dataDir, "gateway-quote-failures");
  const preliveSimulationRuns = await readJsonl(config.dataDir, "prelive-simulation-runs");
  const connectedRefreshRuns = await readJsonl(config.dataDir, "connected-refresh-runs");
  const [
    preliveForkPlan,
    preliveForkSubmissions,
    preliveForkReceipts,
    strategyResearchBoard,
    secondaryStrategyScaffolds,
    deterministicStrategyCandidates,
    phase3StrategyValidation,
    protocolMarketWatchers,
    recursiveWrappedBtcLoop,
    recursiveStablecoinLoop,
    wrappedBtcLendingLoopSlice,
    v1InfraDrills,
    wholeWalletRouteFundingPlans,
    wrappedBtcLoopAutoUnwindRuntime,
    recursiveWrappedBtcLoopAutoUnwindRuntime,
  ] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "prelive-fork-plan.json")),
    readJsonl(config.dataDir, "prelive-fork-submissions"),
    readJsonl(config.dataDir, "prelive-fork-receipts"),
    readJsonIfExists(join(config.dataDir, "strategy-research-board.json")),
    readJsonIfExists(join(config.dataDir, "secondary-strategy-scaffolds.json")),
    readJsonIfExists(join(config.dataDir, "deterministic-strategy-candidates.json")),
    readJsonIfExists(join(config.dataDir, "phase3-strategy-validation.json")),
    readJsonIfExists(join(config.dataDir, "protocol-market-watchers.json")),
    readJsonIfExists(join(config.dataDir, "recursive_wrapped_btc_lending_loop-scaffold.json")),
    readJsonIfExists(join(config.dataDir, "recursive_stablecoin_lending_loop-scaffold.json")),
    readJsonIfExists(join(config.dataDir, "wrapped-btc-lending-loop-slice.json")),
    readJsonIfExists(join(config.dataDir, "v1-infra-drills.json")),
    readJsonl(config.dataDir, "whole-wallet-route-funding-plans").catch(() => []),
    readJsonIfExists(join(config.dataDir, "wrapped-btc-loop-base-moonwell-auto-unwind-runtime-latest.json")),
    readJsonIfExists(join(config.dataDir, "recursive_wrapped_btc_lending_loop-auto-unwind-runtime-latest.json")),
  ]);
  const executionEvents = await readJsonl(config.dataDir, "execution-journal");
  const triangleArtifacts = await readTriangleArtifacts(config.dataDir);
  const { routePlan, fundingPlan, nextStep: next, dashboardStatus } = state;
  const canaryInputs = buildCanaryInputSummary(state);
  const payback = await buildPaybackDashboardSlice({
    dataDir: config.dataDir,
    now,
  });
  const btcWatchlist = dashboardStatus?.gateway?.btcWatchlist || buildBtcWatchlistFallbackSummary(state?.routesRecords?.at(-1)?.routes || []);
  const best = next.route || routePlan.topCandidates?.[0] || null;
  const wholeWalletFunding = latestWholeWalletRouteFundingPlan(wholeWalletRouteFundingPlans, {
    routeKey: best?.routeKey || null,
    amount: best?.amount || null,
  });
  const checklist = buildCanaryStageChecklist({
    route: best,
    nextStep: next,
    inputSummary: canaryInputs,
    shadowCycle: dashboardStatus?.shadowCycle || null,
    advanceCanary: dashboardStatus?.canaryAdvance || null,
  });
  const executionStage = buildExecutionStageSummary({
    nextStep: next,
    dashboardStatus,
  });
  const nextReadinessCheck = dashboardStatus?.shadowCycle?.canary?.nextReadinessCheck || null;
  const nextReadinessRefresh = dashboardStatus?.shadowCycle?.canary?.nextReadinessRefresh || null;
  const gasRefresh = planGasRefresh(state);
  const canaryInputRefresh = planCanaryInputRefresh(state);
  const dexRefresh = planDexPriceRefresh(state);
  const blockedScoreRefresh = planBlockedScoreRefresh(state);
  blockedScoreRefresh.srcChain = next.route?.srcChain || null;
  blockedScoreRefresh.dstChain = next.route?.dstChain || null;
  const decayRefresh = planQuoteDecayRefresh(state);
  const gatewayCoverageRefresh = planDexGatewayCoverageRefresh(state);
  const profitabilityDexRouteFocus = buildDexRouteFocusSummary({
    routes: state?.routesRecords?.at(-1)?.routes || [],
    quotes: state?.quotes || [],
    scoreSnapshot: state?.scoreSnapshot || null,
    dexQuotes: state?.dexQuotes || [],
  });
  const profitabilityDexGateway = buildDexGatewayArbitrageSummary({
    scoreSnapshot: state?.scoreSnapshot || null,
    dexQuotes: state?.dexQuotes || [],
  });
  const profitabilityEdgeViability = buildEdgeViabilitySummary({
    scoreSnapshot: state?.scoreSnapshot || null,
    dexQuotes: state?.dexQuotes || [],
  });
  const profitabilityEdgeResearch = buildEdgeResearchSummary({
    scoreSnapshot: state?.scoreSnapshot || null,
    shadowObservations: state?.shadowObservations || [],
  });
  const profitabilityNoEdgePersistence = buildNoEdgePersistenceSummary({
    scoreSnapshot: state?.scoreSnapshot || null,
    dexQuotes: state?.dexQuotes || [],
  });
  const profitabilityEdgeVerdict = buildEdgeViabilityVerdict({
    edgeViability: profitabilityEdgeViability,
    dexRouteFocus: profitabilityDexRouteFocus,
  });
  const profitabilityEthAnalysis = buildEthereumRouteAnalysis({
    routeRecords: state?.routesRecords || [],
    quotes: state?.quotes || [],
    failures: quoteFailures,
    dexQuotes: state?.dexQuotes || [],
    scores: state?.scoreSnapshot?.scores || [],
    shadowObservations: state?.shadowObservations || [],
  });
  const ethProfitability = buildEthProfitabilitySummary(profitabilityEthAnalysis);
  const profitabilitySummary = buildProfitabilitySummary({
    scoreSnapshot: state?.scoreSnapshot || null,
    dexRouteFocus: profitabilityDexRouteFocus,
    dexGatewayArbitrage: profitabilityDexGateway,
    edgeViability: { ...profitabilityEdgeViability, verdict: profitabilityEdgeVerdict },
    noEdgePersistence: profitabilityNoEdgePersistence,
    canaryInputs,
    routePlan,
    ethAnalysis: profitabilityEthAnalysis,
  });
  const proxySpreadSummary = buildBtcProxySpreadSummary({
    dexQuotes: state?.dexQuotes || [],
    routes: state?.routesRecords?.at(-1)?.routes || [],
    scoreSnapshot: state?.scoreSnapshot || null,
  });
  const objectivePlans = buildObjectivePlans({
    routePlan,
    canaryInputs,
    scoreSnapshot: state?.scoreSnapshot || null,
    shadowObservations: state?.shadowObservations || [],
    dexQuotes: state?.dexQuotes || [],
    address: resolved.address,
  });
  const economicsAudit = buildRouteEconomicsAudit({
    scoreSnapshot: state?.scoreSnapshot || null,
    routePlan,
    edgeViability: profitabilityEdgeViability,
    edgeResearch: profitabilityEdgeResearch,
    noEdgePersistence: profitabilityNoEdgePersistence,
    quotes: state?.quotes || [],
    quoteFailures,
    shadowObservations: state?.shadowObservations || [],
  });
  const pivotDecision = buildPivotDecisionSummary({
    economicsAudit,
    objectivePlans,
  });
  let prelive = buildPreliveReadinessSummary({
    overall: dashboardStatus?.overall || {},
    audit: dashboardStatus?.audit || null,
    shadowCycle: dashboardStatus?.shadowCycle || null,
    strategy: dashboardStatus?.strategy || null,
    simulationRuns: preliveSimulationRuns,
    walletReadinessRecords: state?.readinessRecords || [],
    forkExecutionPlans: preliveForkPlan?.plans || [],
    forkExecutionSubmissions: preliveForkSubmissions,
    forkExecutionReceipts: preliveForkReceipts,
    executionEvents,
  });
  const pivotPlan = buildStrategyPivotPlan({
    dashboardStatus: {
      ...dashboardStatus,
      generatedAt: now,
      prelive,
      strategy: {
        ...(dashboardStatus?.strategy || {}),
        objectivePlans,
        ethProfitability,
      },
    },
    state,
    triangleArtifacts,
  });
  const pivotPlanSummary = summarizeStrategyPivotPlan(pivotPlan);
  const yieldShadowBook = buildYieldShadowBook({ pivotPlan });
  const yieldShadowSummary = summarizeYieldShadowBook(yieldShadowBook);
  const proxyCoveragePlan = buildProxySpreadCoveragePlan({ proxySpreadSummary });
  const proxyCoverageSummary = summarizeProxySpreadCoveragePlan(proxyCoveragePlan);
  const dashboardStatusForExecutionPack = {
    ...dashboardStatus,
    payback,
    canaryInputs,
    prelive,
    strategy: {
      ...(dashboardStatus?.strategy || {}),
      pivotDecision,
      pivotPlan: pivotPlanSummary,
      yieldShadowBook: yieldShadowSummary,
      proxySpreadCoveragePlan: proxyCoverageSummary,
      ethProfitability,
    },
    shadowCycle: dashboardStatus?.shadowCycle
      ? {
          ...dashboardStatus.shadowCycle,
          pivotDecision,
        }
      : dashboardStatus?.shadowCycle,
  };
  dashboardStatusForExecutionPack.prelive = {
    ...(dashboardStatusForExecutionPack.prelive || {}),
    v1InfraDrills: summarizeV1InfraDrills(v1InfraDrills),
  };
  dashboardStatusForExecutionPack.liveBaseline = buildLiveBaselineSummary({
    dashboardStatus: dashboardStatusForExecutionPack,
    nextStep: next,
  });
  const allocatorCore = buildAllocatorCore({
    strategySnapshot: null,
    phase3Validation: phase3StrategyValidation,
    wrappedBtcLendingLoopSlice,
    recursiveWrappedBtcLoop,
    recursiveStablecoinLoop,
    secondaryStrategyScaffolds,
    protocolMarketWatchers,
    now,
  });
  const strategySnapshot = buildStrategySnapshot({
    dashboardStatus: dashboardStatusForExecutionPack,
    state,
    triangleArtifacts,
    phase3StrategyValidation,
    allocatorCore,
    strategyResearchBoard,
    secondaryStrategyScaffolds,
    deterministicStrategyCandidates,
    leverageAutoUnwindRuntimeReports: [
      wrappedBtcLoopAutoUnwindRuntime,
      recursiveWrappedBtcLoopAutoUnwindRuntime,
    ].filter(Boolean),
    now,
  });
  const strategySnapshotSummary = summarizeStrategySnapshot(strategySnapshot);
  const phase3StrategyValidationSummary = summarizePhase3StrategyValidation(phase3StrategyValidation);
  const dashboardStatusWithSnapshot = {
    ...dashboardStatusForExecutionPack,
    strategy: {
      ...dashboardStatusForExecutionPack.strategy,
      strategySnapshot: strategySnapshotSummary,
    },
  };
  const reviewPackage = buildPreliveReviewPackage({
    dashboardStatus: dashboardStatusWithSnapshot,
    canaryInputs,
    canarySelectionGap: profitabilitySummary.canarySelectionGap || null,
    nextStep: next,
    advanceCanary: dashboardStatus?.canaryAdvance || null,
    address: resolved.address,
    strategySnapshot: strategySnapshotSummary,
    wrappedBtcLendingLoopSlice,
    recursiveWrappedBtcLoop,
    recursiveStablecoinLoop,
    phase3Validation: phase3StrategyValidation,
    protocolMarketWatchers,
    now,
  });
  const measuredLeaderWholeWalletFunding = latestWholeWalletRouteFundingPlan(wholeWalletRouteFundingPlans, {
    routeKey: reviewPackage?.measuredLeaderReview?.routeKey || null,
    amount: reviewPackage?.measuredLeaderReview?.amount || null,
  });
  const evidenceCampaign = buildPreliveEvidenceCampaign({
    reviewPackage,
    shadowRefreshBatchSummary: dashboardStatus?.shadowCycle?.refreshBatch || null,
    simulationRuns: preliveSimulationRuns,
    forkExecutionPlans: preliveForkPlan?.plans || [],
    forkExecutionSubmissions: preliveForkSubmissions,
    forkExecutionReceipts: preliveForkReceipts,
  });
  reviewPackage.remediationPlan = buildAdmissionRemediationPlan({
    reviewPackage,
    evidenceCampaign,
    address: resolved.address,
  });
  prelive = buildPreliveReadinessSummary({
    overall: dashboardStatus?.overall || {},
    audit: dashboardStatus?.audit || null,
    shadowCycle: dashboardStatus?.shadowCycle || null,
    strategy: dashboardStatus?.strategy || null,
    reviewPackage,
    simulationRuns: preliveSimulationRuns,
    walletReadinessRecords: state?.readinessRecords || [],
    forkExecutionPlans: preliveForkPlan?.plans || [],
    forkExecutionSubmissions: preliveForkSubmissions,
    forkExecutionReceipts: preliveForkReceipts,
    executionEvents,
  });
  dashboardStatusForExecutionPack.prelive = {
    ...(dashboardStatusForExecutionPack.prelive || {}),
    ...prelive,
    v1InfraDrills: summarizeV1InfraDrills(v1InfraDrills),
  };
  dashboardStatusWithSnapshot.prelive = dashboardStatusForExecutionPack.prelive;
  const connectedRefreshPackage = buildConnectedRefreshPackage({
    dashboardStatus: dashboardStatusWithSnapshot,
    canaryInputs,
    reviewPackage,
    nextStep: next,
    address: resolved.address,
    now,
  });
  const connectedRefreshSummary = summarizeConnectedRefreshPackage(connectedRefreshPackage);
  const connectedRefreshExecutionSummary = buildConnectedRefreshExecutionSummary(connectedRefreshRuns, now);
  const currentRoutePrelivePassRuns = await readJsonl(config.dataDir, "current-route-prelive-passes");
  const currentRoutePrelivePassSummary = buildCurrentRoutePrelivePassSummary(currentRoutePrelivePassRuns, now);
  const executionRunbook = buildExecutionRunbook({
    dashboardStatus: dashboardStatusWithSnapshot,
    reviewPackage,
    strategySnapshot,
    canaryInputs,
    nextStep: next,
    forkPlan: preliveForkPlan,
    address: resolved.address,
    now,
  });
  const executionRunbookSummary = summarizeExecutionRunbook(executionRunbook);
  const exactRouteForkPackage = buildExactRouteForkPackage({
    dashboardStatus: dashboardStatusWithSnapshot,
    canaryInputs,
    reviewPackage,
    nextStep: next,
    forkPlan: preliveForkPlan,
    simulationRuns: preliveSimulationRuns,
    submissions: preliveForkSubmissions,
    receipts: preliveForkReceipts,
    connectedRefreshPackage,
    now,
  });
  const exactRouteForkSummary = summarizeExactRouteForkPackage(exactRouteForkPackage);
  const preliveValidation = buildPreliveValidationReport({
    dashboardStatus: dashboardStatusWithSnapshot,
    strategySnapshot,
    executionRunbook,
    reviewPackage,
    connectedRefreshPackage,
    exactRouteForkPackage,
    now,
  });
  const preliveValidationSummary = summarizePreliveValidationReport(preliveValidation);
  const operationalJudgmentReview = buildOperationalJudgmentReview({
    dashboardStatus: dashboardStatusWithSnapshot,
    strategySnapshot,
    reviewPackage,
    executionRunbook,
    preliveValidation,
    connectedRefreshPackage,
    exactRouteForkPackage,
    now,
  });
  const operationalJudgmentSummary = summarizeOperationalJudgmentReview(operationalJudgmentReview);
  reviewPackage.strategySnapshot = strategySnapshotSummary;
  reviewPackage.executionRunbook = executionRunbookSummary;
  reviewPackage.preliveValidation = preliveValidationSummary;
  reviewPackage.connectedRefreshPackage = connectedRefreshPackage;
  reviewPackage.exactRouteForkPackage = exactRouteForkPackage;
  reviewPackage.operationalJudgmentReview = operationalJudgmentReview;
  dashboardStatusWithSnapshot.prelive = {
    ...(dashboardStatusWithSnapshot.prelive || {}),
    connectedRefresh: connectedRefreshSummary,
    currentRoutePrelivePass: currentRoutePrelivePassSummary,
    executionRunbook: executionRunbookSummary,
    exactRouteForkPackage: exactRouteForkSummary,
    operationalJudgmentReview: operationalJudgmentSummary,
    validation: preliveValidationSummary,
  };
  dashboardStatusWithSnapshot.liveBaseline = buildLiveBaselineSummary({
    dashboardStatus: dashboardStatusWithSnapshot,
    nextStep: next,
  });

  const doc = [
    "# Current Status",
    "",
    `Updated: ${now}`,
    "",
    "## Start Here",
    "",
    "- Read this file first in a shallow session.",
    "- Main command: `npm run advance:canary`",
    "- Decision-pack refresh: `npm run build:prelive-decision-pack`",
    "- Queue preview: `npm run run:shadow-refresh-queue -- --limit=3`",
    "- Batch preview: `npm run run:shadow-refresh-batch -- --limit=1`",
    "- Evidence campaign preview: `npm run run:prelive-evidence-campaign`",
    "- Safe status refresh: `npm run audit:overfit && npm run score:gateway -- --write && npm run status:dashboard`",
    "- Payback preview: `npm run report:payback-status -- --json`",
    "- Live baseline preview: `npm run report:live-baseline -- --json`",
    "- V1 infra drills preview: `npm run report:v1-infra-drills -- --json`",
    "- Pivot plan refresh: `npm run report:pivot-plan -- --write`",
    "- Strategy snapshot refresh: `npm run report:strategy-snapshot -- --write`",
    "- Deterministic candidate refresh: `npm run report:deterministic-strategy-candidates -- --write`",
    "- Connected refresh pack: `npm run report:connected-refresh-package -- --write`",
    "- Current-route pass report: `npm run report:current-route-prelive-pass -- --write`",
    "- Connected pre-live pass: `npm run run:current-route-prelive-pass -- --execute`",
    "- Execution runbook refresh: `npm run report:execution-runbook -- --write`",
    "- Exact-route fork pack: `npm run report:exact-route-fork-package -- --write`",
    "- Yield shadow book refresh: `npm run report:yield-shadow-book -- --write`",
    "- Proxy coverage refresh: `npm run report:proxy-spread-coverage -- --write`",
    "- Pre-live readiness refresh: `npm run report:prelive-readiness -- --write`",
    "- Pre-live validation refresh: `npm run validate:prelive-readiness -- --write`",
    "- Operational judgment refresh: `npm run report:operational-judgment-review -- --write`",
    "- Review package refresh: `npm run build:prelive-review-package -- --write`",
    "- Fork execution planning: `npm run plan:prelive-fork-execution -- --source=objective --write`",
    "",
    "## One-page Execution Brief",
    "",
    ...onePageExecutionBriefLines({
      dashboardStatus: dashboardStatusWithSnapshot,
      next,
      best,
      address: resolved.address,
      pivotPlan: pivotPlanSummary,
      yieldShadow: {
        ...yieldShadowSummary,
        profiles: yieldShadowBook.profiles || [],
      },
      proxyCoverage: proxyCoverageSummary,
      strategySnapshot: strategySnapshotSummary,
      phase3StrategyValidation: phase3StrategyValidationSummary,
      executionRunbook: executionRunbookSummary,
      preliveValidation: preliveValidationSummary,
      connectedRefreshPackage: connectedRefreshSummary,
      connectedRefreshExecution: connectedRefreshExecutionSummary,
      exactRouteForkPackage: exactRouteForkSummary,
      operationalJudgmentReview: operationalJudgmentSummary,
      wholeWalletFunding,
    }),
    "",
    "## Strategy Snapshot",
    "",
    ...strategySnapshotLines(strategySnapshotSummary, strategySnapshot, phase3StrategyValidationSummary),
    "",
    "## V1 Infra Drills",
    "",
    ...v1InfraDrillLines(dashboardStatus?.prelive?.v1InfraDrills || null),
    "",
    "## Execution Runbook",
    "",
    ...executionRunbookLines(executionRunbookSummary, executionRunbook),
    "",
    "## Pre-live Validation",
    "",
    ...preliveValidationLines(preliveValidationSummary),
    "",
    "## Connected Refresh Package",
    "",
    ...connectedRefreshLines(connectedRefreshSummary),
    ...connectedRefreshExecutionLines(connectedRefreshExecutionSummary),
    ...currentRoutePrelivePassLines(currentRoutePrelivePassSummary),
    "",
    "## Exact-route Fork Package",
    "",
    ...exactRouteForkPackageLines(exactRouteForkSummary),
    "",
    "## Operational Judgment Review",
    "",
    ...operationalJudgmentLines(operationalJudgmentSummary, operationalJudgmentReview),
    "",
    "## Live Baseline",
    "",
    ...liveBaselineLines(dashboardStatusWithSnapshot?.liveBaseline || null),
    "",
    "## Current Phase",
    "",
    `- Address: \`${resolved.address}\``,
    "- Phase: canary-prep gating before exact gas",
    `- Decision: \`${next.decision}\``,
    `- Headline: ${next.headline}`,
    `- Live trading: \`${dashboardStatus?.overall?.liveTrading || "BLOCKED"}\``,
    `- Shadow trading: \`${dashboardStatus?.overall?.shadowTrading || "ALLOWED"}\``,
    "",
    "## Payback Readiness",
    "",
    ...paybackLines(dashboardStatusWithSnapshot?.payback || null),
    "",
    "## Progress Snapshot",
    "",
    ...checklistLines(checklist),
    ...executionStageLines(executionStage),
    "",
    "## Best Route Right Now",
    "",
    best
      ? `- Route: \`${best.label}\``
      : "- Route: none",
    best
      ? `- Route key: \`${best.routeKey}\` amount=\`${best.amount}\``
      : "- Route key: none",
    best
      ? `- txReady=${best.txReady} exactGasDone=${best.exactGasDone} viableForPrep=${best.viableForPrep}`
      : "- txReady=false exactGasDone=false viableForPrep=false",
    best
      ? `- Input value: ${money(best.inputUsd)}`
      : "- Input value: n/a",
    best
      ? `- Prep funding estimate: ${money(best.prepFundingUsd)}`
      : "- Prep funding estimate: n/a",
    best
      ? `- Net edge now: ${money(best.netEdgeUsd)}`
      : "- Net edge now: n/a",
    tradeReadinessLine(best),
    nextReadinessCheck
      ? `- Next readiness check: \`${nextReadinessCheck.label}\` amount=\`${nextReadinessCheck.amount}\``
      : "- Next readiness check: none",
    readinessRefreshLine(nextReadinessRefresh),
    nextFocusLine(best),
    "",
    "## Required Actions Before Exact Gas",
    "",
    ...linesForActions(next.actions),
    "",
    "## Objective Verification",
    "",
    "- This file does not execute validation by itself.",
    "- Rerun `npm run check` before acting on code changes.",
    "- Rerun `npm test` before acting on behavior assumptions.",
    `- Candidate routes observed: ${routePlan.candidateCount}`,
    `- txReady routes: ${routePlan.txReadyCount}`,
    `- viable prep routes: ${routePlan.viableCount}`,
    "",
    "## Shadow Roster",
    "",
    ...shadowRosterLines(routePlan, {
      quotes: state?.quotes || [],
      quoteFailures,
      shadowObservations: state?.shadowObservations || [],
      scores: state?.scoreSnapshot?.scores || [],
    }),
    "",
    "## Shadow Actions",
    "",
    ...shadowActionLines(routePlan, resolved.address),
    "",
    "## Refresh Queue",
    "",
    ...refreshQueueLines(dashboardStatus?.shadowCycle?.refreshQueue || []),
    "",
    "## Refresh Queue Execution",
    "",
    ...refreshExecutionLines(dashboardStatus?.shadowCycle?.refreshExecution || null),
    "",
    "## Refresh Batch Loop",
    "",
    ...refreshBatchLines(dashboardStatus?.shadowCycle?.refreshBatch || null),
    "",
    "## Objective Plans",
    "",
    ...objectivePlanLines(objectivePlans),
    "",
    "## Pivot Gate",
    "",
    ...pivotDecisionLines(pivotDecision),
    "",
    "## Pivot Plan",
    "",
    ...pivotPlanLines(pivotPlanSummary),
    "",
    "## Yield Shadow Book",
    "",
    ...yieldShadowBookLines(yieldShadowSummary, yieldShadowBook.profiles || []),
    "",
    "## Proxy Coverage Plan",
    "",
    ...proxyCoveragePlanLines(proxyCoverageSummary, proxyCoveragePlan.plan || []),
    "",
    "## Pre-live Readiness",
    "",
    ...preliveLines(prelive),
    "",
    "## Tiny Live Review Package",
    "",
    ...preliveReviewPackageLines(reviewPackage, { wholeWalletFunding: measuredLeaderWholeWalletFunding }),
    "",
    "## Pre-live Evidence Campaign",
    "",
    ...preliveEvidenceCampaignLines(evidenceCampaign),
    "",
    "## Profitability Summary",
    "",
    ...overfitAuditLines(dashboardStatus?.audit),
    "",
    ...profitabilityLines(profitabilitySummary),
    "",
    ...strategyLines(
      state?.scoreSnapshot?.scores || [],
      state?.shadowObservations || [],
      state?.dexQuotes || [],
      state?.routesRecords?.at(-1)?.routes || [],
      state?.routesRecords?.at(-1)?.observedAt || null,
      state?.quotes || [],
      routePlan,
      canaryInputs,
      resolved.address,
      ethProfitability,
    ),
    quoteDecayLine(dashboardStatus?.audit),
    priceCoverageLine(dashboardStatus?.market),
    ...quoteableCoverageLine(dashboardStatus?.market),
    ...btcWatchlistLines(btcWatchlist),
    lastAdvanceLine(dashboardStatus?.canaryAdvance),
    ...canaryInputsLines(canaryInputs),
    canaryInputRefreshLine(canaryInputRefresh),
    gasRefreshLine(gasRefresh),
    dexRefreshLine(dexRefresh, state),
    gatewayCoverageLine(gatewayCoverageRefresh),
    blockedScoreLine(blockedScoreRefresh),
    quoteDecayRefreshLine(decayRefresh),
    `- estimator wallet checked routes: ${fundingPlan.routeCount}`,
    `- estimator skipped routes: ${fundingPlan.skippedRouteCount}`,
    `- skipped reasons: ${fundingPlan.failureReasons.map((item) => `${item.reason}:${item.count}`).join(",") || "none"}`,
    "",
    "## Next Command Order After Funding",
    "",
    "1. `npm run check:estimator-wallet -- --route-key=\"<routeKey>\" --amount=\"<amount>\"`",
    `2. \`npm run estimate:gateway-gas -- --from="${resolved.address}" --route-key="<routeKey>" --amount="<amount>"\``,
    "3. `npm run score:gateway -- --write`",
    "4. `npm run status:dashboard`",
    "5. `npm run advance:canary`",
    "",
    "## Important Files",
    "",
    "- `src/cli/advance-canary.mjs`",
    "- `src/cli/plan-canary-next-step.mjs`",
    "- `src/cli/plan-canary-routes.mjs`",
    "- `src/cli/plan-estimator-wallet.mjs`",
    "- `src/estimator/canary-next-step.mjs`",
    "- `src/estimator/canary-route-plan.mjs`",
    "- `src/estimator/funding-plan.mjs`",
    "- `src/prelive/execution-sim.mjs`",
    "- `src/prelive/fork-execution.mjs`",
    "- `src/prelive/readiness.mjs`",
    "- `src/prelive/review-package.mjs`",
    "- `src/prelive/evidence-campaign.mjs`",
    "- `src/strategy/pivot-plan.mjs`",
    "- `src/ledger/yield-shadow-book.mjs`",
    "- `src/strategy/proxy-spread-coverage-plan.mjs`",
    "- `src/cli/report-pivot-plan.mjs`",
    "- `src/cli/report-payback-status.mjs`",
    "- `src/cli/report-yield-shadow-book.mjs`",
    "- `src/cli/report-proxy-spread-coverage-plan.mjs`",
    "- `src/cli/run-prelive-simulations.mjs`",
    "- `src/cli/report-prelive-readiness.mjs`",
    "- `src/cli/build-prelive-review-package.mjs`",
    "- `src/cli/run-prelive-evidence-campaign.mjs`",
    "- `src/cli/plan-prelive-fork-execution.mjs`",
    "- `src/cli/submit-prelive-fork-execution.mjs`",
    "- `src/cli/reconcile-prelive-fork-execution.mjs`",
    "- `src/strategy/objective-plans.mjs`",
    "- `src/config/payback.mjs`",
    "- `src/executor/payback/accumulator.mjs`",
    "- `src/executor/payback/scheduler.mjs`",
    "- `src/session/shadow-refresh-runner.mjs`",
    "- `src/cli/run-shadow-refresh-queue.mjs`",
    "- `src/session/shadow-refresh-batch.mjs`",
    "- `src/cli/run-shadow-refresh-batch.mjs`",
    "- `docs/current-status.md`",
    "",
    "## Backup Note",
    "",
    "- `.env` and `data/` stay out of git.",
    "- This repo is safe to back up publicly only if you are comfortable exposing source; operational secrets are ignored by git.",
    "- Prefer a private GitHub repo for backup.",
    "",
  ].filter((line) => line != null).join("\n");

  const outputPath = join(process.cwd(), OUTPUT_PATH);
  const result = await writeTextIfChanged(outputPath, `${doc}\n`, {
    normalize: normalizeCurrentStatusDoc,
  });
  console.log(`${result.changed ? "wrote" : "unchanged"}=${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
