#!/usr/bin/env node

/**
 * report-strategy-tick-slice.mjs
 *
 * Reads `logs/strategy-tick.jsonl` (latest entry per strategy) plus the
 * fast-track promotion evaluation, and writes a focused JSON slice the
 * dashboard renders without touching the full dashboard-status builder.
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

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  evaluatePromotionEvidence,
  PROMOTION_THRESHOLDS,
  PROMOTION_THRESHOLDS_STRICT,
} from "../strategy/promotion-evidence.mjs";
import { getStrategyCaps } from "../config/strategy-caps.mjs";
import { buildMicroCanarySlice } from "../status/micro-canary-slice.mjs";
import { buildStrategyStageSlice } from "../status/strategy-stage-slice.mjs";
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

function readJsonlSafe(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
      Number(row.promotion?.fastTrack?.consecutiveSuccess ?? 0),
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

function main() {
  const args = parseArgs(process.argv);
  const strategies = args.strategies.length > 0 ? args.strategies : DEFAULT_STRATEGIES;
  const tickPath = resolve(args["tick-log"] || "logs/strategy-tick.jsonl");
  const auditPath = resolve(args.audit || "logs/signer-audit.jsonl");
  const reconciliationsPath = resolve(args.reconciliations || "data/receipt-reconciliations.jsonl");
  const canaryPaths = [
    args["canary-log"] ? resolve(args["canary-log"]) : resolve("data/merkl-canary-autopilot-runs.jsonl"),
    resolve("data/erc4626-protocol-canaries.jsonl"),
    resolve("data/aave-protocol-canaries.jsonl"),
  ];
  const outPath = resolve(args.out || "dashboard/public/strategy-tick-status.json");

  const ticks = readJsonlSafe(tickPath);
  const audit = readJsonlSafe(auditPath);
  const reconciliations = readJsonlSafe(reconciliationsPath);
  const canaryLedgerEvidence = buildCanaryLedgerEvidence(canaryPaths.flatMap(readJsonlSafe));
  const reconciliationByTxHash = new Map();
  for (const rec of reconciliations) {
    if (rec.txHash) reconciliationByTxHash.set(String(rec.txHash).toLowerCase(), rec);
  }
  const latestByStrategy = latestTickPerStrategy(ticks);
  const nowMs = Date.now();

  const strategyRows = strategies.map((sid) => {
    const tick = latestByStrategy.get(sid) || null;
    const tickBlocker = tick?.blockers?.find((b) => b.strategyId === sid) || null;
    const tickSnapshot = tick?.snapshotSummary?.find((item) => item?.strategyId === sid) || null;
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
          realizedProfitSats: Math.max(0, rec?.realized?.realizedNetPnlSats ?? 0),
        };
      });

    const promotionFastTrack = evaluatePromotionEvidence({
      strategyId: sid,
      receipts,
      nowMs,
    });
    const promotionStrict = evaluatePromotionEvidence({
      strategyId: sid,
      receipts,
      nowMs,
      lookbackDays: 14,
      thresholds: PROMOTION_THRESHOLDS_STRICT,
    });
    const strategyCaps = getStrategyCaps(sid);
    const operatorHold = OPERATOR_HELD_STRATEGIES.has(sid);
    const capAutoExecute = strategyCaps?.autoExecute === true;
    const autoExecute = capAutoExecute && operatorHold !== true;
    const demotion = evaluateDemotionPolicy({ strategyId: sid, receipts, nowMs });
    const liveEligible = promotionFastTrack.eligible === true
      && autoExecute
      && operatorHold !== true
      && demotion.demoted !== true;

    return {
      strategyId: sid,
      lastTickAt: tick?.tickAt || null,
      lastTickMode: tickBlocker?.mode || null,
      lastTickBlockers: tickBlocker?.blockers || [],
      lastTickCandidateCount: tick?.candidateCount ?? 0,
      lastTickAllowCount: tick?.dispatchSummary?.allowCount ?? 0,
      lastTickDenyCount: tick?.dispatchSummary?.denyCount ?? 0,
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
      receiptCountSignerBacked: receipts.filter((r) => r?.source === "signer").length,
      autoExecute,
      operatorHold,
      liveEligibility: {
        liveEligible,
        blockers: [
          ...(promotionFastTrack.eligible ? [] : ["promotion_evidence_not_eligible"]),
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
      generatedIntentCount: (tick?.generatedIntents || []).filter((i) => i.strategyId === sid).length,
      promotion: {
        fastTrack: {
          eligible: promotionFastTrack.eligible,
          blockers: promotionFastTrack.blockers.map((b) => b.kind),
          signerBackedReceiptCount: promotionFastTrack.evidence?.signerBackedReceiptCount ?? 0,
          consecutiveSuccess: promotionFastTrack.evidence?.consecutiveSuccess ?? 0,
        },
        strict: {
          eligible: promotionStrict.eligible,
          blockers: promotionStrict.blockers.map((b) => b.kind),
        },
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

  const promotionEvidence = Object.fromEntries(
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
  const strategyStageSlice = buildStrategyStageSlice(dedupedLatestReports, promotionEvidence, demotionEvidence);

  const slice = {
    schemaVersion: 2,
    generatedAt: new Date(nowMs).toISOString(),
    fastTrackThresholds: PROMOTION_THRESHOLDS,
    strictThresholds: PROMOTION_THRESHOLDS_STRICT,
    tickCountTotal: ticks.length,
    latestTickAt: ticks.length > 0
      ? ticks.map((t) => t.tickAt).sort().slice(-1)[0]
      : null,
    strategies: strategyRows,
    summary: {
      strategiesTracked: strategies.length,
      strategiesWithTick: strategyRows.filter((s) => s.lastTickAt).length,
      strategiesMissingCaps: strategyRows.filter((s) => s.capsConfigured === false).length,
      strategiesEligibleFastTrack: strategyRows.filter((s) => s.promotion.fastTrack.eligible).length,
      strategiesLiveEligible: strategyRows.filter((s) => s.liveEligibility.liveEligible).length,
      strategiesOperatorHold: strategyRows.filter((s) => s.operatorHold).length,
      strategiesEligibleStrict: strategyRows.filter((s) => s.promotion.strict.eligible).length,
      totalSignerBackedReceipts: strategyRows.reduce((acc, s) => acc + s.receiptCountSignerBacked, 0),
      strategiesWithGeneratedIntents: strategyRows.filter((s) => s.generatedIntentCount > 0).length,
      totalGeneratedIntents: strategyRows.reduce((acc, s) => acc + s.generatedIntentCount, 0),
    },
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
      console.log(`  withTick=${slice.summary.strategiesWithTick} eligibleFastTrack=${slice.summary.strategiesEligibleFastTrack} eligibleStrict=${slice.summary.strategiesEligibleStrict}`);
      console.log(`  totalSignerBackedReceipts=${slice.summary.totalSignerBackedReceipts} generatedIntents=${slice.summary.totalGeneratedIntents}`);
    }
  }
}

main();
