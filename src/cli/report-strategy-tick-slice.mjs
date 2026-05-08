#!/usr/bin/env node

/**
 * report-strategy-tick-slice.mjs
 *
 * Reads `logs/strategy-tick.jsonl` (latest entry per strategy) plus signer
 * receipt/demotion context, and writes a focused JSON slice the dashboard
 * renders without touching the full dashboard-status builder.
 *
 *   node src/cli/report-strategy-tick-slice.mjs \
 *     [--tick-log=logs/strategy-tick.jsonl] \
 *     [--audit=logs/signer-audit.jsonl] \
 *     [--out=dashboard/public/strategy-tick-status.json] \
 *     [--strategy=beefy-folding-vault] [--strategy=...] \
 *     [--quiet] [--json]
 *
 * Exit code 0 even if logs are empty — the slice still publishes the
 * fact that no tick has been observed yet, which is itself signal.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { basename, resolve, dirname, extname } from "node:path";
import {
  dashboardJsonOutputPath,
  hasFlag,
  optionMapFromArgs,
} from "../dashboard/live-snapshot-paths.mjs";
import { ABSOLUTE_FLOOR_SATS, PAYBACK_CONFIG } from "../config/payback.mjs";
import { getStrategyCaps } from "../config/strategy-caps.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildMicroCanarySlice } from "../status/micro-canary-slice.mjs";
import { buildStrategyStageSlice } from "../status/strategy-stage-slice.mjs";
import {
  buildOverallBroadcastProgress,
  buildFunnelSummary,
  buildLayerStatus,
  buildStrategyBroadcastProgress,
  buildSurfaceAdvice,
  realizedPnlSatsFromRecord,
} from "../status/strategy-tick-slice.mjs";
import { evaluateDemotionPolicy } from "../executor/policy/demotion-policy.mjs";

const DEFAULT_STRATEGIES = [
  "wrapped-btc-loop-base-moonwell",
  "recursive_wrapped_btc_lending_loop",
  "gateway-btc-onramp",
  "gateway-btc-offramp",
  "gateway-btc-funding-transfer",
  "proxy-spread-experiment",
  "token-dex-experiment",
  "native-dex-experiment",
  "gas-zip-native-refuel",
  "wrapper-btc-arbitrage",
  "beefy-folding-vault",
  "pendle-pt-lbtc-base",
  "aerodrome-cl-base",
  "pendle-pt-solvbtc-bbn-bsc",
  "berachain-bend-bex-bgt",
  "gmx-v2-perp-basis-avax",
  "stablecoin_spread_loop",
  "proxy_spread_expansion",
  "tokenized_reserve_sleeve",
  "gateway_native_asset_conversion_sleeve",
  "recursive_stablecoin_lending_loop",
  "destination_wrapped_btc_rotation",
  "stablecoin_treasury_rotation",
  "gateway_proxy_spread_rebalance_recheck",
  "macro_asset_rotation",
  "eth_destination_deployment",
  "onchain_btc_perp_basis",
];
const OPERATOR_HELD_STRATEGIES = new Set([]);

function parseArgs(argv) {
  const out = { json: false, quiet: false, strategies: [] };
  for (const arg of argv.slice(2)) {
    if (arg === "--json") { out.json = true; continue; }
    if (arg === "--quiet") { out.quiet = true; continue; }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === "strategy") { out.strategies.push(m[2]); continue; }
    out[m[1]] = m[2];
  }
  return out;
}

async function readJsonlSafe(path) {
  const dir = dirname(path);
  const name = basename(path, extname(path));
  return readJsonl(dir, name).catch(() => []);
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeReasonCode(reason) {
  if (typeof reason !== "string" || reason.length === 0) return null;
  return reason.split(":")[0] || reason;
}

function incrementCount(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function objectFromCountMap(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function topCountKey(map) {
  const entries = [...map.entries()];
  if (entries.length === 0) return null;
  entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  return entries[0][0];
}

function blockerCategory(reason) {
  const code = normalizeReasonCode(reason);
  if (!code) return null;
  if (/stale|fresh|quote|feed|oracle/u.test(code)) return "freshness";
  if (/negative|edge|unprofitable|ev|profit/u.test(code)) return "ev";
  if (/cap|auto_execute|policy|demotion|operator_hold/u.test(code)) return "policy";
  if (/signer|receipt|reconciliation|finality/u.test(code)) return "receipt";
  if (/gas|float|inventory|fund/u.test(code)) return "capital";
  if (/adapter|executor|builder|tx_builder|normalization/u.test(code)) return "adapter";
  if (/chain|route|bridge|gateway/u.test(code)) return "routing";
  return "other";
}

function incrementCategoryCounts(categories, reason, count = 1) {
  const category = blockerCategory(reason);
  if (!category) return;
  categories.set(category, (categories.get(category) || 0) + count);
}

function blockerCategoryCounts({
  lastTickBlockers = [],
  denyByReason = new Map(),
  skippedByReason = new Map(),
} = {}) {
  const categories = new Map();
  for (const [reason, count] of denyByReason.entries()) incrementCategoryCounts(categories, reason, count);
  for (const [reason, count] of skippedByReason.entries()) incrementCategoryCounts(categories, reason, count);
  if (categories.size === 0) {
    for (const reason of lastTickBlockers) incrementCategoryCounts(categories, reason, 1);
  }
  return objectFromCountMap(categories);
}

function roundBtcFromSats(sats) {
  const value = finiteNumber(sats);
  if (!Number.isFinite(value)) return 0;
  return Math.round((value / 100_000_000) * 100_000_000_000_000) / 100_000_000_000_000;
}

function buildRegimeBreakdown(receipts = []) {
  const breakdown = {};
  for (const receipt of receipts) {
    const regime = receipt.regime || receipt.marketRegime || "unknown";
    if (!breakdown[regime]) breakdown[regime] = { receipts: 0, realizedNetBtc: 0 };
    breakdown[regime].receipts += 1;
    breakdown[regime].realizedNetBtc += roundBtcFromSats(receipt.realizedProfitSats);
    breakdown[regime].realizedNetBtc = Math.round(breakdown[regime].realizedNetBtc * 100_000_000_000_000) / 100_000_000_000_000;
  }
  return breakdown;
}

function dispatchIntentStatsForStrategy(tick, strategyId) {
  const denyByReason = new Map();
  const allowByChain = new Map();
  const denyByChain = new Map();
  for (const intent of tick?.dispatchIntents || []) {
    if (intent?.strategyId !== strategyId) continue;
    const chain = typeof intent.chain === "string" && intent.chain ? intent.chain : "unknown";
    if (intent.decision === "allow") {
      incrementCount(allowByChain, chain);
      continue;
    }
    if (intent.decision !== "deny") continue;
    incrementCount(denyByChain, chain);
    incrementCount(denyByReason, normalizeReasonCode(intent.reason) || "unknown");
  }
  return {
    denyByReason,
    allowByChain,
    denyByChain,
    topDenyReason: topCountKey(denyByReason),
  };
}

function generatedIntentsForStrategy(tick, strategyId) {
  return (tick?.generatedIntents || []).filter((intent) => intent?.strategyId === strategyId);
}

function policyOkForStrategy({ tick, dispatchStats, generatedIntents = [] } = {}) {
  if (!tick) return false;
  if (tick.dispatchSummary?.globalBlockReason) return false;
  if (dispatchStats.denyByReason.size > 0) return false;
  return generatedIntents.every((intent) => !intent.normalizationError);
}

function killSwitchSetForTick(tick = null) {
  return tick?.killSwitchSet === true ||
    tick?.runtime?.killSwitchSet === true ||
    tick?.broadcastSummary?.skippedReason === "kill_switch";
}

function latestBroadcastTxHashForTick({ tick, receipts = [] } = {}) {
  if (!tick || tick.broadcastSummary?.broadcastCount === 0) return null;
  const tickMs = Date.parse(tick.tickAt || "");
  const candidates = receipts
    .filter((receipt) => receipt.txHash)
    .filter((receipt) => {
      if (!Number.isFinite(tickMs)) return true;
      return Number.isFinite(receipt.tsMs) && receipt.tsMs >= tickMs;
    })
    .sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));
  return candidates[0]?.txHash || null;
}

function skippedStatsForStrategy(tick, strategyId) {
  const skippedByReason = new Map();
  const skipped = [
    ...(tick?.builder?.skipped || []),
    ...(tick?.builderSkipped || []),
  ];
  for (const item of skipped) {
    if (item?.strategyId !== strategyId) continue;
    incrementCount(skippedByReason, normalizeReasonCode(item.reason) || "unknown");
  }
  return skippedByReason;
}

function latestTickPerStrategy(ticks) {
  // Each tick record carries `strategies: [...]`. Index by strategy.
  const byStrategy = new Map();
  for (const t of ticks) {
    for (const sid of t.strategies || []) {
      const cur = byStrategy.get(sid);
      if (!cur || new Date(t.tickAt) > new Date(cur.tickAt)) byStrategy.set(sid, t);
    }
  }
  return byStrategy;
}

function tickTimesPerStrategy(ticks = []) {
  const byStrategy = new Map();
  for (const tick of ticks) {
    const tickMs = Date.parse(tick?.tickAt || "");
    if (!Number.isFinite(tickMs)) continue;
    for (const strategyId of tick.strategies || []) {
      if (!byStrategy.has(strategyId)) byStrategy.set(strategyId, []);
      byStrategy.get(strategyId).push(tickMs);
    }
  }
  return byStrategy;
}

function canaryStrategyId(record = {}) {
  return record?.plan?.strategyId ||
    record?.execution?.plan?.strategyId ||
    record?.queueItem?.mappedStrategyId ||
    record?.summary?.selectedStrategyId ||
    record?.strategyId ||
    null;
}

function canaryWasDelivered(record = {}) {
  return record?.status === "delivered" ||
    record?.execution?.settlementStatus === "delivered" ||
    record?.summary?.proofStatus === "delivered" ||
    Number(record?.summary?.deliveredCount ?? 0) > 0;
}

function canaryWasPreviewReady(record = {}) {
  return record?.status === "preview_ready" ||
    Number(record?.summary?.previewReadyCount ?? 0) > 0;
}

function canaryRealizedNetUsd(record = {}) {
  return [
    record?.realized?.realizedNetPnlUsd,
    record?.receiptIngest?.receiptRecord?.realized?.realizedNetPnlUsd,
    record?.execution?.receiptIngest?.receiptRecord?.realized?.realizedNetPnlUsd,
  ]
    .map(finiteNumber)
    .find((value) => value !== null);
}

function buildCanaryLedgerEvidence(records = []) {
  const byStrategy = new Map();
  const ensure = (strategyId) => {
    if (!byStrategy.has(strategyId)) {
      byStrategy.set(strategyId, {
        deliveredCount: 0,
        previewReadyCount: 0,
        realizedNetUsd: 0,
        hasRealizedNetUsd: false,
      });
    }
    return byStrategy.get(strategyId);
  };
  for (const record of records || []) {
    const strategyId = canaryStrategyId(record);
    if (!strategyId) continue;
    const evidence = ensure(strategyId);
    if (canaryWasDelivered(record)) evidence.deliveredCount += 1;
    if (canaryWasPreviewReady(record)) evidence.previewReadyCount += 1;
    const realizedNetUsd = canaryRealizedNetUsd(record);
    if (realizedNetUsd !== null) {
      evidence.realizedNetUsd += realizedNetUsd;
      evidence.hasRealizedNetUsd = true;
    }
  }
  return byStrategy;
}

function microStatusFromCounts({ signerBackedCount = 0, previewReadyCount = 0 } = {}) {
  if (signerBackedCount >= 3) return "micro_canary_repeatable";
  if (signerBackedCount >= 1) return "minimal_live_proof_exists";
  if (previewReadyCount >= 1) return "micro_canary_ready";
  return "not_started";
}

const MICRO_STATUS_RANK = Object.freeze({
  not_started: 0,
  micro_canary_ready: 1,
  minimal_live_proof_exists: 2,
  micro_canary_repeatable: 3,
});

function strongerMicroStatus(left = "not_started", right = "not_started") {
  return (MICRO_STATUS_RANK[right] ?? 0) > (MICRO_STATUS_RANK[left] ?? 0) ? right : left;
}

function enrichReportsWithMicroCanaryEvidence(reports = [], strategyRows = [], canaryLedgerEvidence = new Map()) {
  const rowsByStrategy = new Map(strategyRows.map((row) => [row.strategyId, row]));
  return reports.map((report) => {
    const strategyId = report?.strategyId;
    if (!strategyId) return report;
    const row = rowsByStrategy.get(strategyId) || {};
    const ledger = canaryLedgerEvidence.get(strategyId) || {};
    const signerBackedCount = Math.max(
      Number(report?.evidence?.signerBackedCount ?? 0),
      Number(row.receiptCountSignerBacked ?? 0),
      Number(ledger.deliveredCount ?? 0),
    );
    const passedCount = Math.max(
      Number(report?.evidence?.passedCount ?? 0),
      Number(row.receiptCountSignerBacked ?? 0),
      Number(ledger.deliveredCount ?? 0),
    );
    const previewReadyCount = Number(ledger.previewReadyCount ?? 0) + Number(report?.evidence?.previewReadyCount ?? 0);
    const derivedStatus = microStatusFromCounts({ signerBackedCount, previewReadyCount });
    const microCanaryStatus = strongerMicroStatus(report.microCanaryStatus || "not_started", derivedStatus);
    const realizedNetUsd = ledger.hasRealizedNetUsd
      ? ledger.realizedNetUsd
      : report?.evidence?.realizedNetUsd ?? null;
    return {
      ...report,
      microCanaryStatus,
      evidence: {
        ...(report.evidence || {}),
        signerBackedCount,
        passedCount,
        previewReadyCount,
        realizedNetUsd,
      },
    };
  });
}

function microHasMinimalProof(report = null) {
  return (MICRO_STATUS_RANK[report?.microCanaryStatus] ?? 0) >= MICRO_STATUS_RANK.minimal_live_proof_exists;
}

async function main() {
  const args = parseArgs(process.argv);
  const argv = process.argv.slice(2);
  const options = optionMapFromArgs(argv);
  const strategies = args.strategies.length > 0 ? args.strategies : DEFAULT_STRATEGIES;
  const tickPath = resolve(args["tick-log"] || "logs/strategy-tick.jsonl");
  const auditPath = resolve(args.audit || "logs/signer-audit.jsonl");
  const reconciliationsPath = resolve(args.reconciliations || "data/receipt-reconciliations.jsonl");
  const canaryPaths = [
    args["canary-log"] ? resolve(args["canary-log"]) : resolve("data/merkl-canary-autopilot-runs.jsonl"),
    resolve("data/erc4626-protocol-canaries.jsonl"),
    resolve("data/aave-protocol-canaries.jsonl"),
  ];
  const outPath = resolve(
    dashboardJsonOutputPath("strategy-tick-status.json", {
      options: { ...options, out: args.out },
      commitPublic: hasFlag(argv, "--commit-public"),
    }),
  );

  const [ticks, audit, reconciliations, ...canaryRecords] = await Promise.all([
    readJsonlSafe(tickPath),
    readJsonlSafe(auditPath),
    readJsonlSafe(reconciliationsPath),
    ...canaryPaths.map(readJsonlSafe),
  ]);
  const canaryLedgerEvidence = buildCanaryLedgerEvidence(canaryRecords.flat());
  const reconciliationByTxHash = new Map();
  for (const rec of reconciliations) {
    if (rec.txHash) reconciliationByTxHash.set(String(rec.txHash).toLowerCase(), rec);
  }
  const latestByStrategy = latestTickPerStrategy(ticks);
  const tickTimesByStrategy = tickTimesPerStrategy(ticks);
  const allTickTimes = ticks
    .map((tick) => Date.parse(tick?.tickAt || ""))
    .filter(Number.isFinite);
  const nowMs = Date.now();
  const paybackEffectiveMinSource = args["payback-effective-min-sats"]
    ? "cli_arg"
    : "payback_config_absolute_floor_default";
  const paybackEffectiveMinSats = finiteNumber(args["payback-effective-min-sats"]) ??
    PAYBACK_CONFIG.absoluteFloorSats ??
    ABSOLUTE_FLOOR_SATS;
  const paybackBaseRatio = finiteNumber(args["payback-base-ratio"]) ?? PAYBACK_CONFIG.baseRatio;
  const allBroadcastReceipts = [];

  const strategyRows = strategies.map((sid) => {
    const tick = latestByStrategy.get(sid) || null;
    const tickBlocker = tick?.blockers?.find((b) => b.strategyId === sid) || null;
    const tickSnapshot = tick?.snapshotSummary?.find((item) => item?.strategyId === sid) || null;
    const dispatchStats = dispatchIntentStatsForStrategy(tick, sid);
    const skippedStats = skippedStatsForStrategy(tick, sid);
    const generatedIntents = generatedIntentsForStrategy(tick, sid);
    const topBlocker = tickBlocker?.blockers?.[0] || null;
    const receipts = audit
      .filter((r) => r?.strategyId === sid)
      .map((r) => {
        const txHash = r.broadcast?.txHash || r.lifecycle?.txHash || r.txHash || null;
        const rec = txHash ? reconciliationByTxHash.get(String(txHash).toLowerCase()) : null;
        return {
          ...r,
          tsMs: Date.parse(r.timestamp || r.observedAt || 0),
          source: r.source || (r.broadcast?.txHash ? "signer" : null),
          outcome: r.outcome || (["confirmed", "broadcasted", "signed"].includes(r.lifecycle?.stage) ? "success" : (r.error ? "failure" : "pending")),
          txHash,
          realizedProfitSats: realizedPnlSatsFromRecord({
            ...r,
            realizedProfitSats: rec?.realized?.realizedNetPnlSats,
          }),
          regime: rec?.regime || rec?.marketRegime || rec?.marketState?.regime || r.regime || r.marketRegime || null,
        };
      });
    allBroadcastReceipts.push(...receipts);
    const broadcastProgress = buildStrategyBroadcastProgress({
      receipts,
      tickTimes: tickTimesByStrategy.get(sid) || [],
      effectiveMinPaybackSats: paybackEffectiveMinSats,
      paybackBaseRatio,
    });

    const strategyCaps = getStrategyCaps(sid);
    const operatorHold = OPERATOR_HELD_STRATEGIES.has(sid);
    const capAutoExecute = strategyCaps?.autoExecute === true;
    const autoExecute = capAutoExecute && operatorHold !== true;
    const demotion = evaluateDemotionPolicy({ strategyId: sid, receipts, nowMs });
    const consecutiveFailureLock = demotion.triggers.some((trigger) => /consecutive/i.test(trigger.kind || ""));
    const policyOk = policyOkForStrategy({ tick, dispatchStats, generatedIntents });
    const killSwitchSet = killSwitchSetForTick(tick);
    const reportSummary = (tick?.reportSummaries || []).find((report) => report?.strategyId === sid) || null;
    const surfaceAdvice = buildSurfaceAdvice({
      report: reportSummary,
      tickBlockers: tickBlocker?.blockers || [],
    });
    const layerStatus = buildLayerStatus({
      tickPresent: Boolean(tick),
      tickReason: topBlocker,
      autoExecute,
      capsConfigured: tickSnapshot?.capsConfigured ?? false,
      policyOk,
      killSwitchSet,
      consecutiveFailureLock,
      surfaceAdvice,
      intentCount: generatedIntents.length,
      broadcastTxHash: latestBroadcastTxHashForTick({ tick, receipts }),
    });
    const liveEligible = autoExecute
      && operatorHold !== true
      && demotion.demoted !== true;
    const receiptCountSignerBacked = receipts.filter((r) => r?.source === "signer").length;

    return {
      strategyId: sid,
      lastTickAt: tick?.tickAt || null,
      lastTickMode: tickBlocker?.mode || null,
      lastTickBlockers: tickBlocker?.blockers || [],
      topBlocker,
      topBlockerCode: normalizeReasonCode(topBlocker),
      lastTickCandidateCount: tick?.candidateCount ?? 0,
      lastTickAllowCount: tick?.dispatchSummary?.allowCount ?? 0,
      lastTickDenyCount: tick?.dispatchSummary?.denyCount ?? 0,
      lastTickDenyByReason: objectFromCountMap(dispatchStats.denyByReason),
      topDenyReason: dispatchStats.topDenyReason,
      lastTickAllowByChain: objectFromCountMap(dispatchStats.allowByChain),
      lastTickDenyByChain: objectFromCountMap(dispatchStats.denyByChain),
      lastTickSkippedByReason: objectFromCountMap(skippedStats),
      blockerCountByCategory: blockerCategoryCounts({
        lastTickBlockers: tickBlocker?.blockers || [],
        denyByReason: dispatchStats.denyByReason,
        skippedByReason: skippedStats,
      }),
      capsConfigured: tickSnapshot?.capsConfigured ?? null,
      operatorAddress: tickSnapshot?.operatorAddress ?? null,
      gasFloatConfiguredChainCount: tickSnapshot?.gasFloatSummary?.configuredChainCount ?? 0,
      gasFloatObservedChainCount: tickSnapshot?.gasFloatSummary?.observedChainCount ?? 0,
      gasFloatMissingChains: (tickSnapshot?.gasFloatSummary?.chains || [])
        .filter((item) => item?.missingReason)
        .map((item) => ({
          chain: item.chain,
          reason: item.missingReason,
        })),
      receiptCountTotal: receipts.length,
      receiptCountSignerBacked,
      autoExecute,
      operatorHold,
      firstLiveBroadcastAt: broadcastProgress.firstLiveBroadcastAt,
      firstLiveBroadcastTxHash: broadcastProgress.firstLiveBroadcastTxHash,
      firstRealizedPnlSats: broadcastProgress.firstRealizedPnlSats,
      paybackEffectiveMinReachedAt: broadcastProgress.paybackEffectiveMinReachedAt,
      lastSignerAuditStage: broadcastProgress.lastSignerAuditStage,
      lastSignerAuditStageAt: broadcastProgress.lastSignerAuditStageAt,
      paybackProgressTrajectory: broadcastProgress.paybackProgressTrajectory,
      layerStatus,
      liveEligibility: {
        liveEligible,
        blockers: [
          ...(autoExecute ? [] : ["strategy_auto_execute_disabled"]),
          ...(operatorHold ? ["operator_hold"] : []),
          ...(demotion.demoted ? ["demotion_policy_triggered"] : []),
        ],
      },
      demotion: {
        demoted: demotion.demoted,
        triggers: demotion.triggers.map((t) => t.kind),
        signerBackedReceiptCount: demotion.evidence?.signerBackedReceiptCount ?? 0,
      },
      scoredAllocation: (tick?.scoredAllocationDetails || [])
        .find((a) => a.strategyId === sid) || null,
      chainScoreSource: ((tick?.scoredAllocationDetails || [])
        .find((a) => a.strategyId === sid) || {})?.chainScoreSource || tick?.scoredAllocation?.chainScoreSource || null,
      chainScoreObservedAt: ((tick?.scoredAllocationDetails || [])
        .find((a) => a.strategyId === sid) || {})?.chainScoreObservedAt || tick?.scoredAllocation?.chainScoreObservedAt || null,
      regimeBreakdown: buildRegimeBreakdown(receipts),
      generatedIntentCount: generatedIntents.length,
      policyReadiness: {
        autoExecute,
        capAutoExecute,
        operatorHold,
        demoted: demotion.demoted,
        policyOk,
        killSwitchSet,
        consecutiveFailureLock,
        signerBackedReceiptCount: receiptCountSignerBacked,
        receiptCountTotal: receipts.length,
      },
    };
  });

  const latestTick = ticks.length > 0
    ? ticks.reduce((a, b) => new Date(a.tickAt) > new Date(b.tickAt) ? a : b)
    : null;
  const reportSummaries = latestTick?.reportSummaries || [];
  const allReportSummaries = ticks.flatMap((t) => t.reportSummaries || []);
  const latestReportSummariesByStrategy = new Map();
  for (const r of reportSummaries) {
    latestReportSummariesByStrategy.set(r.strategyId, r);
  }
  const dedupedLatestReports = enrichReportsWithMicroCanaryEvidence(
    [...latestReportSummariesByStrategy.values()],
    strategyRows,
    canaryLedgerEvidence,
  );
  const enrichedReportsByStrategy = new Map(dedupedLatestReports.map((report) => [report.strategyId, report]));

  const liveReadinessEvidence = Object.fromEntries(
    strategyRows.map((s) => {
      const report = enrichedReportsByStrategy.get(s.strategyId) || null;
      return [
        s.strategyId,
        {
          eligible: s.liveEligibility.liveEligible && microHasMinimalProof(report),
        },
      ];
    }),
  );
  const demotionEvidence = Object.fromEntries(
    strategyRows.map((s) => [s.strategyId, { demoted: s.demotion.demoted, triggers: s.demotion.triggers }]),
  );
  const microCanarySlice = buildMicroCanarySlice(dedupedLatestReports);
  const strategyStageSlice = buildStrategyStageSlice(dedupedLatestReports, liveReadinessEvidence, demotionEvidence);
  const funnel = buildFunnelSummary(strategyRows);
  const overallBroadcastProgress = buildOverallBroadcastProgress({
    receipts: allBroadcastReceipts,
    tickTimes: allTickTimes,
    effectiveMinPaybackSats: paybackEffectiveMinSats,
    paybackBaseRatio,
    nowMs,
  });

  const slice = {
    schemaVersion: 5,
    generatedAt: new Date(nowMs).toISOString(),
    tickCountTotal: ticks.length,
    latestTickAt: ticks.length > 0
      ? ticks.map((t) => t.tickAt).sort().slice(-1)[0]
      : null,
    strategies: strategyRows,
    summary: {
      strategiesTracked: strategies.length,
      strategiesWithTick: strategyRows.filter((s) => s.lastTickAt).length,
      strategiesMissingCaps: strategyRows.filter((s) => s.capsConfigured === false).length,
      strategiesLiveEligible: strategyRows.filter((s) => s.liveEligibility.liveEligible).length,
      strategiesOperatorHold: strategyRows.filter((s) => s.operatorHold).length,
      totalSignerBackedReceipts: strategyRows.reduce((acc, s) => acc + s.receiptCountSignerBacked, 0),
      strategiesWithGeneratedIntents: strategyRows.filter((s) => s.generatedIntentCount > 0).length,
      totalGeneratedIntents: strategyRows.reduce((acc, s) => acc + s.generatedIntentCount, 0),
      ...funnel,
    },
    overall: overallBroadcastProgress,
    paybackProgressPolicy: {
      effectiveMinPaybackSats: paybackEffectiveMinSats,
      effectiveMinSource: paybackEffectiveMinSource,
      baseRatio: paybackBaseRatio,
      authority: "reporting_only_estimate",
    },
    funnel,
    microCanary: microCanarySlice,
    strategyStage: strategyStageSlice,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(slice, null, 2));

  if (!args.quiet) {
    if (args.json) {
      console.log(JSON.stringify({ outPath, slice }));
    } else {
      console.log(`strategy-tick slice written: ${outPath}`);
      console.log(`  ticks=${slice.tickCountTotal} strategies=${slice.summary.strategiesTracked}`);
      console.log(`  withTick=${slice.summary.strategiesWithTick} liveEligible=${slice.summary.strategiesLiveEligible}`);
      console.log(`  totalSignerBackedReceipts=${slice.summary.totalSignerBackedReceipts} generatedIntents=${slice.summary.totalGeneratedIntents}`);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
