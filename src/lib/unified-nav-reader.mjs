import { readFile, open, stat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { listApprovedOperatorBtcAddresses } from "../config/operator-btc-addresses.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../treasury/policy.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";

const DEFAULT_DISCREPANCY_THRESHOLD_PCT = 10;
const TAIL_CHUNK_BYTES = 256 * 1024;
const ESPLORA_BASE = process.env.BTC_ESPLORA_BASE || "https://mempool.space/api";
const BTC_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_AGE_MS = Number(process.env.UNIFIED_NAV_MAX_AGE_MS || 15 * 60_000); // 15 min

function ageMs(observedAt, now = Date.now()) {
  if (!observedAt) return null;
  const t = new Date(observedAt).getTime();
  return Number.isFinite(t) ? now - t : null;
}

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

async function lastJsonlRow(absolutePath) {
  let info;
  try {
    info = await stat(absolutePath);
  } catch {
    return null;
  }
  if (!info.isFile() || info.size === 0) return null;

  const handle = await open(absolutePath, "r");
  try {
    let position = info.size;
    let buffer = "";
    while (position > 0) {
      const chunkSize = Math.min(TAIL_CHUNK_BYTES, position);
      position -= chunkSize;
      const chunk = Buffer.alloc(chunkSize);
      await handle.read(chunk, 0, chunkSize, position);
      buffer = chunk.toString("utf8") + buffer;
      const lastNewline = buffer.lastIndexOf("\n");
      if (lastNewline < 0) continue;
      const tail = buffer.slice(lastNewline + 1).trim();
      if (tail) {
        try {
          return JSON.parse(tail);
        } catch {
          buffer = buffer.slice(0, lastNewline);
          continue;
        }
      }
      buffer = buffer.slice(0, lastNewline);
    }
    const remainder = buffer.trim();
    if (!remainder) return null;
    try {
      return JSON.parse(remainder);
    } catch {
      return null;
    }
  } finally {
    await handle.close();
  }
}

async function streamJsonlMap(absolutePath, keySelector) {
  const out = new Map();
  let contents;
  try {
    const info = await stat(absolutePath);
    if (!info.isFile() || info.size === 0) return out;
    if (info.size > 256 * 1024 * 1024) {
      const { createReadStream } = await import("node:fs");
      const { createInterface } = await import("node:readline");
      await new Promise((resolveStream, rejectStream) => {
        const rl = createInterface({ input: createReadStream(absolutePath, { encoding: "utf8" }) });
        rl.on("line", (line) => {
          if (!line.trim()) return;
          try {
            const row = JSON.parse(line);
            const key = keySelector(row);
            if (key) out.set(key, row);
          } catch {
            // skip
          }
        });
        rl.on("close", resolveStream);
        rl.on("error", rejectStream);
      });
      return out;
    }
    contents = await readFile(absolutePath, "utf8");
  } catch {
    return out;
  }
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const key = keySelector(row);
      if (key) out.set(key, row);
    } catch {
      // skip
    }
  }
  return out;
}

async function loadEvmWalletUsdLive(dataDir) {
  try {
    const resolved = await resolveOperationalAddress({ dataDir });
    if (!resolved?.address) {
      return { source: "evm_live_scan", valueUsd: null, observedAt: null, error: "no_operator_address" };
    }
    const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
    const prices = await getCoinGeckoPricesUsd().catch(() => emptyPricesUsd());
    const inventory = await scanTreasuryInventory({
      policy,
      address: resolved.address,
      prices,
      continueOnError: true,
    });
    const value = finite(inventory?.summary?.estimatedWalletUsd);
    return {
      source: "evm_live_scan",
      valueUsd: value,
      observedAt: inventory?.observedAt || new Date().toISOString(),
      ageMs: 0,
      scanErrorCount: inventory?.summary?.scanErrorCount ?? 0,
      address: inventory?.address || resolved.address,
      inventory,
    };
  } catch (error) {
    return { source: "evm_live_scan", valueUsd: null, observedAt: null, error: String(error?.message || error) };
  }
}

async function loadEvmWalletUsd(dataDir, { liveScan = true, allowStaleFallback = false } = {}) {
  if (liveScan) {
    const live = await loadEvmWalletUsdLive(dataDir);
    if (live.valueUsd != null) return live;
    if (!allowStaleFallback) {
      return {
        ...live,
        source: live.source || "evm_live_scan",
        valueUsd: null,
        fallback: false,
        note: "evm live scan failed; stale jsonl fallback refused",
      };
    }
  } else if (!allowStaleFallback) {
    return {
      source: "evm_live_scan",
      valueUsd: null,
      observedAt: null,
      fallback: false,
      note: "liveEvm=false and allowStaleEvmFallback=false — refusing to read jsonl projection",
    };
  }
  const row = await lastJsonlRow(join(dataDir, "treasury-inventory.jsonl"));
  const observedAt = row?.observedAt || null;
  const value = finite(row?.summary?.estimatedWalletUsd);
  return {
    source: "treasury-inventory.jsonl",
    valueUsd: value,
    observedAt,
    ageMs: ageMs(observedAt),
    fallback: true,
    warning: "treasury-inventory.jsonl is a recorded snapshot, not chain truth; use liveScan:true unless intentionally backtesting",
  };
}

async function loadEvmAutopilotUsd(dataDir) {
  const snapshot = await readJsonIfExists(join(dataDir, "all-chain-autopilot-latest.json"));
  const observedAt = snapshot?.observedAt || null;
  const value = finite(snapshot?.summary?.capitalManager?.estimatedAssetValueUsd);
  return {
    source: "all-chain-autopilot-latest.json",
    valueUsd: value,
    observedAt,
    ageMs: ageMs(observedAt),
  };
}

async function loadBobL2WbtcUsd(dataDir) {
  const row = await lastJsonlRow(join(dataDir, "treasury-inventory.jsonl"));
  if (!row || !Array.isArray(row.tokens)) {
    return { source: "treasury-inventory.jsonl#tokens[chain=bob]", valueUsd: null, observedAt: row?.observedAt || null };
  }
  const total = row.tokens
    .filter((token) => token?.chain === "bob")
    .reduce((sum, token) => sum + (finite(token.estimatedUsd) ?? 0), 0);
  return {
    source: "treasury-inventory.jsonl#tokens[chain=bob]",
    valueUsd: total,
    observedAt: row.observedAt || null,
    note: "subset of evmWalletUsd; reported separately for audit, not added to unified total",
  };
}

async function fetchJson(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), BTC_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAddressSats(address) {
  const data = await fetchJson(`${ESPLORA_BASE}/address/${address}`);
  const chain = data?.chain_stats || {};
  const mem = data?.mempool_stats || {};
  const confirmedSats = Number(chain.funded_txo_sum || 0) - Number(chain.spent_txo_sum || 0);
  const mempoolSats = Number(mem.funded_txo_sum || 0) - Number(mem.spent_txo_sum || 0);
  return { address, confirmedSats, mempoolSats };
}

async function fetchBtcPriceUsd() {
  const data = await fetchJson(`${ESPLORA_BASE}/v1/prices`);
  const price = finite(data?.USD) ?? finite(data?.usd);
  return price;
}

async function loadBtcL1UsdLive() {
  const addresses = listApprovedOperatorBtcAddresses({ includeObservationOnly: true });
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return { source: "esplora_live", valueUsd: null, observedAt: null, error: "no_operator_btc_addresses" };
  }
  try {
    const [balances, priceUsd] = await Promise.all([
      Promise.all(addresses.map(fetchAddressSats)),
      fetchBtcPriceUsd(),
    ]);
    const totalSats = balances.reduce((s, b) => s + b.confirmedSats, 0);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      return { source: "esplora_live", valueUsd: null, observedAt: new Date().toISOString(), error: "btc_price_unavailable", totalSats };
    }
    const valueUsd = (totalSats / 1e8) * priceUsd;
    return {
      source: "esplora_live",
      valueUsd,
      observedAt: new Date().toISOString(),
      totalSats,
      btcPriceUsd: priceUsd,
      addresses: balances.map((b) => ({ address: b.address, confirmedSats: b.confirmedSats })),
    };
  } catch (error) {
    return { source: "esplora_live", valueUsd: null, observedAt: null, error: String(error?.message || error) };
  }
}

async function loadBtcL1Usd(dataDir, { liveFetch = true, allowStaleFallback = false } = {}) {
  if (liveFetch) {
    const live = await loadBtcL1UsdLive();
    if (live.valueUsd != null) return live;
    if (!allowStaleFallback) {
      return {
        ...live,
        source: live.source || "esplora_live",
        valueUsd: null,
        fallback: false,
        note: "esplora live fetch failed; stale jsonl fallback refused because recorded rows reflect money_loop projection, not chain truth",
      };
    }
  } else if (!allowStaleFallback) {
    return {
      source: "esplora_live",
      valueUsd: null,
      observedAt: null,
      fallback: false,
      note: "liveBtc=false and allowStaleBtcFallback=false — refusing to read jsonl projection",
    };
  }
  let contents = "";
  try {
    contents = await readFile(join(dataDir, "btc-nav-history.jsonl"), "utf8");
  } catch {
    return { source: "btc-nav-history.jsonl", valueUsd: null, observedAt: null, fallback: true };
  }
  const records = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < contents.length; i += 1) {
    const ch = contents[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") { inString = true; continue; }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          records.push(JSON.parse(contents.slice(start, i + 1)));
        } catch {
          // skip
        }
        start = -1;
      }
    }
  }
  const row = records.at(-1);
  const value = finite(row?.totalUsd);
  return {
    source: "btc-nav-history.jsonl",
    valueUsd: value,
    observedAt: row?.observedAt || null,
    fallback: true,
    warning: "btc-nav-history.jsonl stores money_loop accumulator projection, not on-chain balance — only used because allowStaleFallback=true",
  };
}

const MARK_EVENT_NAMES = new Set(["mark", "position_marked"]);

async function loadProtocolPositionMarksUsd(dataDir) {
  const auditPairs = await lastJsonlRowsByStrategy(join(dataDir, "capital-audit-pairs.jsonl"));
  const closedStrategies = new Set();
  for (const [strategy, row] of auditPairs.entries()) {
    if (row?.status === "closed") closedStrategies.add(strategy);
  }
  const positions = await latestMarkPerPositionId(join(dataDir, "protocol-position-marks.jsonl"));
  let totalAll = 0;
  let totalClosedOnly = 0;
  let positionCountAll = 0;
  let positionCountClosed = 0;
  let staleFailedCount = 0;
  const perPosition = [];
  for (const mark of positions.values()) {
    if (!MARK_EVENT_NAMES.has(mark.event)) {
      if (mark.event === "position_mark_failed") staleFailedCount += 1;
      continue;
    }
    const valueUsd = finite(mark.valueUsd);
    if (valueUsd == null || valueUsd <= 0) continue;
    totalAll += valueUsd;
    positionCountAll += 1;
    if (!mark.strategyId || closedStrategies.has(mark.strategyId)) {
      totalClosedOnly += valueUsd;
      positionCountClosed += 1;
    }
    perPosition.push({
      positionId: mark.positionId,
      strategyId: mark.strategyId,
      protocolId: mark.protocolId,
      chain: mark.chain,
      valueUsd,
      observedAt: mark.observedAt,
      auditPairStatus: closedStrategies.has(mark.strategyId) ? "closed" : "open_or_unknown",
    });
  }
  return {
    source: "protocol-position-marks.jsonl (latest position_marked per positionId)",
    valueUsd: positionCountAll > 0 ? totalAll : null,
    positionCount: positionCountAll,
    closedAuditPairSubsetUsd: positionCountClosed > 0 ? totalClosedOnly : null,
    closedAuditPairSubsetCount: positionCountClosed,
    staleFailedAdapterCount: staleFailedCount,
    perPosition,
    note: "ALL open marked positions are added to unified NAV; the closed-audit-pair subset is reported for double-count audit only",
  };
}

async function lastJsonlRowsByStrategy(absolutePath) {
  return streamJsonlMap(absolutePath, (row) => row?.strategyId || null);
}

async function latestMarkPerPositionId(absolutePath) {
  return streamJsonlMap(absolutePath, (row) => row?.positionId || null);
}

function discrepancyPct(a, b) {
  if (a == null || b == null) return null;
  const maxAbs = Math.max(Math.abs(a), Math.abs(b));
  if (maxAbs === 0) return 0;
  return (Math.abs(a - b) / maxAbs) * 100;
}

export async function loadUnifiedOperatingCapital({
  dataDir = config.dataDir,
  discrepancyThresholdPct = DEFAULT_DISCREPANCY_THRESHOLD_PCT,
  liveBtc = true,
  allowStaleBtcFallback = false,
  liveEvm = true,
  allowStaleEvmFallback = false,
  maxRecordedAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  const [evmWallet, evmAutopilot, bobL2Wbtc, btcL1, protocolMarks] = await Promise.all([
    loadEvmWalletUsd(dataDir, { liveScan: liveEvm, allowStaleFallback: allowStaleEvmFallback }),
    loadEvmAutopilotUsd(dataDir),
    loadBobL2WbtcUsd(dataDir),
    loadBtcL1Usd(dataDir, { liveFetch: liveBtc, allowStaleFallback: allowStaleBtcFallback }),
    loadProtocolPositionMarksUsd(dataDir),
  ]);

  const evmDiscrepancyPct = discrepancyPct(evmWallet.valueUsd, evmAutopilot.valueUsd);
  const evmDiscrepancyFlag =
    evmDiscrepancyPct != null && evmDiscrepancyPct > discrepancyThresholdPct ? "evm_source_disagreement" : null;

  const evmAggregate = evmWallet.valueUsd != null && evmAutopilot.valueUsd != null
    ? Math.max(evmWallet.valueUsd, evmAutopilot.valueUsd)
    : (evmWallet.valueUsd ?? evmAutopilot.valueUsd ?? null);

  const missingSources = [];
  if (evmWallet.valueUsd == null) missingSources.push("evmWalletUsd");
  if (evmAutopilot.valueUsd == null) missingSources.push("evmAutopilotUsd");
  if (btcL1.valueUsd == null) missingSources.push("btcL1Usd");

  const protocolMarksUsd = protocolMarks?.valueUsd ?? null;
  const unifiedNavUsd = evmAggregate != null && btcL1.valueUsd != null
    ? evmAggregate + btcL1.valueUsd + (protocolMarksUsd ?? 0)
    : null;

  const flags = [];
  if (evmDiscrepancyFlag) flags.push(evmDiscrepancyFlag);
  if (missingSources.length > 0) flags.push("source_missing");
  if (btcL1.fallback === true) flags.push("btc_l1_stale_fallback");
  if (evmWallet.fallback === true) flags.push("evm_wallet_stale_fallback");
  const staleSources = [];
  for (const [name, slice] of [["evmWalletUsd", evmWallet], ["evmAutopilotUsd", evmAutopilot]]) {
    if (slice.ageMs != null && slice.ageMs > maxRecordedAgeMs) staleSources.push(name);
  }
  if (staleSources.length > 0) flags.push("recorded_source_stale");

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    unifiedNavUsd,
    evmAggregateUsd: evmAggregate,
    btcL1Usd: btcL1.valueUsd,
    discrepancyThresholdPct,
    evmDiscrepancyPct,
    flags,
    missingSources,
    halt:
      flags.includes("evm_source_disagreement") ||
      flags.includes("source_missing") ||
      flags.includes("btc_l1_stale_fallback") ||
      flags.includes("evm_wallet_stale_fallback") ||
      flags.includes("recorded_source_stale"),
    staleSources,
    maxRecordedAgeMs,
    protocolMarksUsd,
    breakdown: {
      evmWalletUsd: evmWallet,
      evmAutopilotUsd: evmAutopilot,
      bobL2WbtcUsd: bobL2Wbtc,
      btcL1Usd: btcL1,
      protocolPositionMarksUsd: protocolMarks,
    },
  };
}

export function operatingCapitalUsdFromUnified(unified) {
  if (!unified || unified.halt) return null;
  return finite(unified.unifiedNavUsd);
}
