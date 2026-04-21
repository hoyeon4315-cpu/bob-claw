// Beefy Vault Snapshot Normalizer.
//
// Pure function. Takes already-fetched Beefy public API responses
// (vaults / apy / tvl / fees) and converts the entries for one
// vaultId into the partial `market` shape that
// evaluateBeefyFoldingAdapter() consumes.
//
// I/O lives elsewhere (a thin async runner CLI fetches the four
// endpoints and passes the JSON in here). This module is fully
// testable with frozen fixtures.
//
// Beefy public REST endpoints:
//   GET https://api.beefy.finance/vaults           → array of vault objs
//   GET https://api.beefy.finance/apy              → { vaultId: decimal }
//   GET https://api.beefy.finance/tvl              → { chainId: { vaultId: usd } }
//   GET https://api.beefy.finance/fees             → { vaultId: { performance: {...} } }
//
// The Beefy adapter's `market` shape requires more fields than Beefy
// alone provides (underlying HF/utilization come from Moonwell;
// slippage/gateway costs come from router quotes). This normalizer
// emits ONLY the Beefy-derived subset and flags the result as
// `partial`. The downstream caller is responsible for merging in
// underlying-protocol and gateway snapshots before invoking the
// evaluator. The adapter then naturally blocks on any missing field.

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pickVault(vaults, vaultId) {
  if (!Array.isArray(vaults)) return null;
  return vaults.find((v) => v && v.id === vaultId) || null;
}

function decimalToBps(decimal) {
  if (typeof decimal !== "number" || !Number.isFinite(decimal)) return null;
  return Math.round(decimal * 10_000);
}

function performanceFeeBps(feesEntry) {
  if (!feesEntry || typeof feesEntry !== "object") return null;
  const perf = feesEntry.performance;
  if (!perf || typeof perf !== "object") return null;
  // Beefy fees endpoint reports performance.total as a decimal share
  // of harvested yield (e.g. 0.095 = 9.5% of yield). That maps
  // 1:1 to the adapter's beefyPerformanceFeeBps.
  return decimalToBps(perf.total);
}

function tvlForVault(tvl, chainId, vaultId) {
  if (!tvl || typeof tvl !== "object") return null;
  const chainBucket = tvl[String(chainId)];
  if (!chainBucket || typeof chainBucket !== "object") return null;
  const v = chainBucket[vaultId];
  return num(v);
}

const ACTIVE_STATUSES = new Set(["active"]);
const PAUSED_STATUSES = new Set(["paused", "eol"]);

/**
 * @param {{
 *   vaults?: object[],
 *   apy?: Record<string, number>,
 *   tvl?: Record<string, Record<string, number>>,
 *   fees?: Record<string, object>,
 *   vaultId: string,
 *   chainId: number | string,
 * }} input
 */
export function normalizeBeefySnapshot(input = {}) {
  const { vaults = [], apy = {}, tvl = {}, fees = {}, vaultId, chainId } = input;
  if (typeof vaultId !== "string" || !vaultId) {
    throw new TypeError("vaultId required");
  }
  if (chainId == null) {
    throw new TypeError("chainId required");
  }

  const vault = pickVault(vaults, vaultId);
  const apyDecimal = num(apy?.[vaultId]);
  const tvlUsd = tvlForVault(tvl, chainId, vaultId);
  const feesEntry = fees?.[vaultId] ?? null;

  const status = vault?.status ?? null;
  let vaultPaused = null;
  if (PAUSED_STATUSES.has(status)) vaultPaused = true;
  else if (ACTIVE_STATUSES.has(status)) vaultPaused = false;

  const market = {
    vaultTvlUsd: tvlUsd,
    reportedNetApyBps: decimalToBps(apyDecimal),
    beefyPerformanceFeeBps: performanceFeeBps(feesEntry),
    vaultPaused,
  };

  const missing = [];
  if (!vault) missing.push("vault_metadata");
  if (apyDecimal == null) missing.push("apy");
  if (tvlUsd == null) missing.push("tvl");
  if (market.beefyPerformanceFeeBps == null) missing.push("performance_fee");
  if (vaultPaused == null) missing.push("vault_status");

  return Object.freeze({
    schemaVersion: 1,
    vaultId,
    chainId,
    sourceStatus: status,
    market: Object.freeze(market),
    partial: true,
    missing: Object.freeze(missing),
  });
}

export { ACTIVE_STATUSES, PAUSED_STATUSES };
