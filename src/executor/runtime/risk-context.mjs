import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../../config/env.mjs";
import { readJsonl } from "../../lib/jsonl-read.mjs";

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positionUsd(position = {}) {
  return finite(position.amountUsd) ??
    finite(position.targetUsd) ??
    finite(position.valueUsd) ??
    finite(position.plan?.amountUsd) ??
    0;
}

function openPosition(position = {}) {
  if (position.status === "closed" || position.event === "position_exit_confirmed") return false;
  return position.status === "open" || position.event === "position_opened";
}

function addShare(out, key, usd, denominatorUsd) {
  if (!key || !(usd > 0) || !(denominatorUsd > 0)) return;
  out[key] = (out[key] || 0) + usd / denominatorUsd;
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function compactArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function positiveCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function buildAssetCoverageEnvelopeFromWalletHoldings({
  walletHoldings = null,
  observedAt = null,
  sourcePath = "dashboard/public/wallet-holdings.json",
} = {}) {
  const assetUniverse = walletHoldings?.assetUniverse || null;
  if (!assetUniverse) return null;

  const unknownAssetBalanceCount = positiveCount(walletHoldings.unknownAssetBalanceCount);
  const unknownTargetCount = positiveCount(assetUniverse.unknownTargetCount);
  const unknownAssetBalances = compactArray(walletHoldings.unknownAssetBalances);
  const unknownTargets = compactArray(assetUniverse.unknownTargets);
  const gaps = [
    ...unknownAssetBalances.map((item) => ({ kind: "unknown_asset_balance", ...item })),
    ...unknownTargets.map((item) => ({ kind: "unknown_target", ...item })),
  ];
  const status = assetUniverse.status || walletHoldings.assetUniverseStatus || "unknown";
  if (status === "needs_review") {
    gaps.push({ kind: "asset_universe_status", status });
  }
  const ok = status === "closed" && unknownAssetBalanceCount === 0 && unknownTargetCount === 0 && gaps.length === 0;

  return {
    status,
    unknownAssetBalanceCount,
    unknownTargetCount,
    gaps,
    ok,
    observedAt,
    sourceObservedAt: walletHoldings.sourceObservedAt ||
      walletHoldings.oldestMaterialSourceObservedAt ||
      walletHoldings.observedAt ||
      null,
    sourcePath,
  };
}

export function buildCurrentAllocationsFromPositions({
  positions = [],
  denominatorUsd = null,
} = {}) {
  const openPositions = (positions || []).filter(openPosition);
  const openTotalUsd = openPositions.reduce((sum, position) => sum + positionUsd(position), 0);
  const denominator = finite(denominatorUsd) ?? openTotalUsd;
  const currentAllocations = {
    perStrategy: {},
    perChain: {},
    perProtocol: {},
    bobL2DirectShare: 0,
    chainSharePct: {},
    protocolSharePct: {},
    opportunitySharePct: {},
  };

  for (const position of openPositions) {
    const usd = positionUsd(position);
    const strategyKey = position.strategyId || position.opportunityId || position.positionId;
    const opportunityKey = position.opportunityId || position.positionId;
    addShare(currentAllocations.perStrategy, strategyKey, usd, denominator);
    addShare(currentAllocations.perChain, position.chain, usd, denominator);
    addShare(currentAllocations.perProtocol, position.protocolId, usd, denominator);
    addShare(currentAllocations.chainSharePct, position.chain, usd, denominator);
    addShare(currentAllocations.protocolSharePct, position.protocolId, usd, denominator);
    addShare(currentAllocations.opportunitySharePct, opportunityKey, usd, denominator);
    if (position.chain === "bob" && position.directHolding === true) {
      currentAllocations.bobL2DirectShare += usd / denominator;
    }
  }

  return {
    openTotalUsd,
    denominatorUsd: denominator > 0 ? denominator : null,
    openPositionCount: openPositions.length,
    currentAllocations,
  };
}

export async function loadRuntimeRiskContext({
  rootDir = process.cwd(),
  activeBudgetUsd = null,
  positionRecords = null,
  walletHoldingsPath = "dashboard/public/wallet-holdings.json",
  now = new Date().toISOString(),
} = {}) {
  const dataDir = resolve(rootDir, config.dataDir);
  const records = Array.isArray(positionRecords)
    ? positionRecords
    : await readJsonl(dataDir, "merkl-portfolio-positions").catch(() => []);
  const walletHoldings = await readJsonIfExists(resolve(rootDir, walletHoldingsPath));
  const assetCoverage = buildAssetCoverageEnvelopeFromWalletHoldings({
    walletHoldings,
    observedAt: now,
    sourcePath: walletHoldingsPath,
  });
  const allocations = buildCurrentAllocationsFromPositions({
    positions: records,
    denominatorUsd: finite(activeBudgetUsd),
  });

  return {
    observedAt: now,
    totalOperatingCapitalUsd: allocations.denominatorUsd,
    currentAllocations: allocations.currentAllocations,
    assetCoverage,
    source: {
      kind: "merkl_portfolio_positions",
      path: `${config.dataDir}/merkl-portfolio-positions.jsonl`,
      positionRecordCount: allocations.openPositionCount,
      openTotalUsd: allocations.openTotalUsd,
      denominatorUsd: allocations.denominatorUsd,
    },
  };
}
