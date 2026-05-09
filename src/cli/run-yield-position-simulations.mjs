#!/usr/bin/env node

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { SMALL_CAPITAL_CAMPAIGN_MODE } from "../config/small-capital-campaign-mode.mjs";
import {
  resolveTinyCanaryExpectedHoldDays,
  tinyCanarySameChainRoundTripCostUsd,
} from "../config/sizing.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildShadowEdgeRecords } from "../strategy/economics/shadow-edge-ingest.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finitePositive(value) {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function optionValue(argv, name) {
  const prefix = `${name}=`;
  const raw = argv.find((item) => item.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : null;
}

function parseArgs(argv = []) {
  return {
    json: hasFlag(argv, "--json"),
    writeShadowEdge: hasFlag(argv, "--write-shadow-edge"),
    limit: finitePositive(optionValue(argv, "--limit")),
    notionalUsd: finitePositive(optionValue(argv, "--notional-usd")) ?? 1000,
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function appendJsonl(path, record) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

function round(value, decimals = 12) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function opportunityStrategyId(opportunity = {}) {
  return opportunity.strategyId || opportunity.mappedStrategyId || opportunity.boundStrategyId || null;
}

function opportunityFamily(opportunity = {}) {
  return opportunity.familyId || opportunity.family || opportunity.strategyKind || "yield_position";
}

function rewardTokenPresent(opportunity = {}) {
  return Boolean(
    opportunity.rewardToken ||
      opportunity.rewardTokenSymbol ||
      opportunity.rewardTokenAddress ||
      opportunity.rewardAsset ||
      opportunity.rewardTokenType ||
      (Array.isArray(opportunity.rewardTokenSymbols) && opportunity.rewardTokenSymbols.length > 0) ||
      (Array.isArray(opportunity.rewardTokenTypes) && opportunity.rewardTokenTypes.length > 0),
  );
}

function rewardHaircutPct(opportunity = {}, policy = SMALL_CAPITAL_CAMPAIGN_MODE, { hasRewardApr = false } = {}) {
  if (!rewardTokenPresent(opportunity) && !hasRewardApr) return 0;
  const tokenType = opportunity.rewardTokenType ||
    (Array.isArray(opportunity.rewardTokenTypes) ? opportunity.rewardTokenTypes[0] : null);
  const haircut = policy.rewardHaircuts?.[tokenType] ?? policy.rewardHaircuts?.defaultRewardToken ?? 0.5;
  return Math.max(0, Math.min(1, Number(haircut) || 0));
}

function resolveAprParts(opportunity = {}) {
  const displayedAprPct = finiteNumber(opportunity.aprPct ?? opportunity.displayedAprPct ?? opportunity.displayedApr);
  const nativeAprPct = finiteNumber(opportunity.nativeAprPct ?? opportunity.baseAprPct ?? opportunity.supplyAprPct);
  const aprPct = displayedAprPct ?? nativeAprPct ?? finiteNumber(opportunity.apr ?? opportunity.apy);
  if (aprPct === null) return null;
  const nativePartPct = nativeAprPct !== null ? Math.max(0, Math.min(aprPct, nativeAprPct)) : rewardTokenPresent(opportunity) ? 0 : aprPct;
  const rewardPartPct = Math.max(0, aprPct - nativePartPct);
  return { aprPct, nativePartPct, rewardPartPct };
}

function resolveHoldingPeriodDays(opportunity = {}, now = new Date().toISOString()) {
  return resolveTinyCanaryExpectedHoldDays({
    expectedHoldDays: opportunity.expectedHoldDays ?? opportunity.holdingPeriodDays,
    campaignRemainingHours: opportunity.campaignRemainingHours,
    campaignEndsAt: opportunity.campaignEndsAt,
    now,
  });
}

function costComponentsUsd(opportunity = {}) {
  const explicitTotal = finiteNumber(opportunity.estimatedCostsUsd ?? opportunity.totalCostsUsd);
  if (explicitTotal !== null) {
    return {
      explicitTotalUsd: Math.max(0, explicitTotal),
    };
  }
  return {
    p90GasUsd: finiteNumber(opportunity.estimatedGasCostUsd) ??
      tinyCanarySameChainRoundTripCostUsd({ chain: opportunity.chain }),
    p90BridgeUsd: finiteNumber(opportunity.estimatedBridgeCostUsd) ?? 0,
    p90ClaimUsd: finiteNumber(opportunity.estimatedClaimCostUsd) ?? 0,
    p90RewardSwapUsd: finiteNumber(opportunity.estimatedRewardSwapCostUsd) ?? 0,
    slippageUsd: finiteNumber(opportunity.estimatedSlippageUsd) ?? 0,
    unwindUsd: finiteNumber(opportunity.estimatedExitCostUsd ?? opportunity.estimatedUnwindCostUsd) ?? 0,
  };
}

function totalCostUsd(components = {}) {
  return Object.values(components).reduce((sum, value) => sum + (finiteNumber(value) ?? 0), 0);
}

export function simulateYieldPositionOpportunity({
  opportunity = {},
  notionalUsd = 1000,
  now = new Date().toISOString(),
  policy = SMALL_CAPITAL_CAMPAIGN_MODE,
} = {}) {
  const strategyId = opportunityStrategyId(opportunity);
  const chain = opportunity.chain || opportunity.destinationChain || null;
  const positionUsd = finitePositive(
    opportunity.notionalUsd ??
      opportunity.amountUsd ??
      opportunity.positionUsd ??
      opportunity.tinyLivePerTxUsd ??
      notionalUsd,
  );
  const holdDays = finitePositive(resolveHoldingPeriodDays(opportunity, now));
  const aprParts = resolveAprParts(opportunity);
  const base = {
    schemaVersion: 1,
    observedAt: now,
    evidenceClass: "yield_shadow",
    queueId: opportunity.queueId || null,
    opportunityId: opportunity.opportunityId || null,
    strategyId,
    chain,
    family: opportunityFamily(opportunity),
    notionalUsd: positionUsd,
    holdingPeriodDays: holdDays,
  };
  if (!strategyId) return { ...base, status: "simulation_failed", skipReason: "strategy_missing" };
  if (!(positionUsd > 0)) return { ...base, status: "simulation_failed", skipReason: "notional_missing" };
  if (!(holdDays > 0)) return { ...base, status: "simulation_failed", skipReason: "holding_period_missing" };
  if (!aprParts) return { ...base, status: "simulation_failed", skipReason: "apr_missing" };

  const haircut = rewardHaircutPct(opportunity, policy, { hasRewardApr: aprParts.rewardPartPct > 0 });
  const nativeYieldUsd = positionUsd * (aprParts.nativePartPct / 100) * (holdDays / 365);
  const rewardYieldUsd = positionUsd * (aprParts.rewardPartPct / 100) * (holdDays / 365);
  const haircutRewardYieldUsd = rewardYieldUsd * (1 - haircut);
  const haircutYieldUsd = nativeYieldUsd + haircutRewardYieldUsd;
  const components = costComponentsUsd(opportunity);
  const costs = totalCostUsd(components);
  const netEdgeUsd = haircutYieldUsd - costs;
  const oneDayGrossYieldUsd = positionUsd * (aprParts.aprPct / 100) / 365;
  const edgeBpsPerDay = (haircutYieldUsd / positionUsd) * 10_000 / holdDays;

  return {
    ...base,
    status: "simulated_ok",
    aprPct: aprParts.aprPct,
    nativeAprPct: aprParts.nativePartPct,
    rewardAprPct: aprParts.rewardPartPct,
    rewardHaircutPct: haircut,
    grossYieldUsd: round(nativeYieldUsd + rewardYieldUsd),
    haircutYieldUsd: round(haircutYieldUsd),
    totalCostsUsd: round(costs),
    costComponentsUsd: components,
    netEdgeUsd: round(netEdgeUsd),
    oneDayGrossYieldUsd: round(oneDayGrossYieldUsd),
    edgeBpsPerDay: round(edgeBpsPerDay),
    estimatedRoundTripCostUsd: round(costs),
    sampleCount: finitePositive(opportunity.sampleCount) ?? 1,
    confidence: 0.5,
  };
}

export function buildYieldPositionSimulationRecords({
  opportunities = [],
  notionalUsd = 1000,
  now = new Date().toISOString(),
  limit = null,
} = {}) {
  const selected = Array.isArray(opportunities) ? opportunities.slice(0, limit || undefined) : [];
  return selected.map((opportunity) =>
    simulateYieldPositionOpportunity({ opportunity, notionalUsd, now }),
  );
}

function mergeShadowEdgeRecords(existing = [], incoming = []) {
  const keyFor = (record) => [
    record.strategyId || "",
    record.chain || "",
    record.family || "",
    record.evidenceClass || "",
  ].join(":");
  const map = new Map();
  for (const record of existing || []) {
    if (record?.strategyId) map.set(keyFor(record), record);
  }
  for (const record of incoming || []) {
    if (record?.strategyId) map.set(keyFor(record), record);
  }
  return [...map.values()].sort((left, right) =>
    String(left.strategyId).localeCompare(String(right.strategyId)) ||
    String(left.chain).localeCompare(String(right.chain)) ||
    String(left.evidenceClass).localeCompare(String(right.evidenceClass)),
  );
}

function buildSummary(records = []) {
  const successCount = records.filter((record) => record.status === "simulated_ok").length;
  const failureCount = records.filter((record) => record.status === "simulation_failed").length;
  return {
    schemaVersion: 1,
    selectedCount: records.length,
    successCount,
    failureCount,
    positiveNetCount: records.filter((record) => (finiteNumber(record.netEdgeUsd) ?? 0) > 0).length,
    yieldShadowCount: records.filter((record) => record.evidenceClass === "yield_shadow").length,
  };
}

function opportunityKey(opportunity = {}) {
  return opportunity.opportunityId ||
    opportunity.queueId ||
    [
      opportunityStrategyId(opportunity) || "unknown_strategy",
      opportunity.chain || opportunity.destinationChain || "unknown_chain",
      opportunity.identifier || opportunity.name || opportunity.protocolId || "unknown_opportunity",
    ].join(":");
}

function dedupeOpportunities(opportunities = []) {
  const byKey = new Map();
  for (const opportunity of opportunities || []) {
    if (!opportunity || typeof opportunity !== "object") continue;
    const key = opportunityKey(opportunity);
    if (!byKey.has(key)) byKey.set(key, opportunity);
  }
  return [...byKey.values()];
}

function reportOpportunities(report = {}) {
  return [
    ...(Array.isArray(report?.opportunities) ? report.opportunities : []),
    ...(Array.isArray(report?.topCandidates) ? report.topCandidates : []),
    ...(Array.isArray(report?.topWatchlist) ? report.topWatchlist : []),
  ];
}

async function readOpportunitySources(dataDir) {
  const [queue, report] = await Promise.all([
    readJsonIfExists(join(dataDir, "merkl-canary-queue.json")),
    readJsonIfExists(join(dataDir, "merkl-opportunities-report.json")),
  ]);
  const queueRows = Array.isArray(queue?.queue) ? queue.queue : Array.isArray(queue?.items) ? queue.items : [];
  const reportRows = reportOpportunities(report);
  return {
    opportunities: dedupeOpportunities([...queueRows, ...reportRows]),
    sourceCounts: {
      merklCanaryQueue: queueRows.length,
      merklOpportunitiesReport: reportRows.length,
    },
  };
}

export async function runYieldPositionSimulationsCli(
  argv = process.argv.slice(2),
  { cwd = process.cwd(), dataDir = resolve(cwd, config.dataDir), now = new Date().toISOString() } = {},
) {
  const args = parseArgs(argv);
  const { opportunities, sourceCounts } = await readOpportunitySources(dataDir);
  const records = buildYieldPositionSimulationRecords({
    opportunities,
    notionalUsd: args.notionalUsd,
    now,
    limit: args.limit,
  });
  const runId = `${now}-${Math.random().toString(16).slice(2)}`;
  const persisted = records.map((record) => ({ ...record, runId }));
  for (const record of persisted) {
    await appendJsonl(join(dataDir, "yield-position-simulation-runs.jsonl"), record);
  }

  let shadowEdgeRecords = [];
  if (args.writeShadowEdge) {
    shadowEdgeRecords = buildShadowEdgeRecords({
      simulationRuns: persisted.filter((record) => record.evidenceClass === "yield_shadow" && record.status === "simulated_ok"),
    });
    const destinationPath = join(dataDir, "destination-economics-shadow-edge.json");
    const existing = await readJsonIfExists(destinationPath);
    const mergedRecords = mergeShadowEdgeRecords(existing?.records || [], shadowEdgeRecords);
    await writeTextIfChanged(
      destinationPath,
      `${JSON.stringify({ schemaVersion: 1, generatedAt: now, records: mergedRecords }, null, 2)}\n`,
      {
        normalize: (contents) => {
          if (!contents) return contents;
          const value = JSON.parse(contents);
          return JSON.stringify({ ...value, generatedAt: null });
        },
      },
    );
    shadowEdgeRecords = mergedRecords;
  }

  const summary = {
    ...buildSummary(records),
    runId,
    generatedAt: now,
    source: "merkl-canary-queue+merkl-opportunities-report",
    sourceCounts,
  };
  const payload = { summary, results: persisted, shadowEdgeRecords };
  const stdout = args.json
    ? `${JSON.stringify(payload, null, 2)}\n`
    : [
        `runId=${runId}`,
        `selectedCount=${summary.selectedCount}`,
        `successCount=${summary.successCount}`,
        `failureCount=${summary.failureCount}`,
        `positiveNetCount=${summary.positiveNetCount}`,
        args.writeShadowEdge ? `shadowEdgeCount=${shadowEdgeRecords.length}` : null,
      ].filter(Boolean).join("\n") + "\n";
  return { exitCode: 0, stdout, payload };
}

if (IS_MAIN) {
  runYieldPositionSimulationsCli().then((result) => {
    process.stdout.write(result.stdout);
    process.exit(result.exitCode);
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
