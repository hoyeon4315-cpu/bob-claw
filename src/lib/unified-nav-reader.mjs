import { readFile, open, stat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { listApprovedOperatorBtcAddresses } from "../config/operator-btc-addresses.mjs";

const DEFAULT_DISCREPANCY_THRESHOLD_PCT = 10;
const TAIL_CHUNK_BYTES = 256 * 1024;
const ESPLORA_BASE = process.env.BTC_ESPLORA_BASE || "https://mempool.space/api";
const BTC_FETCH_TIMEOUT_MS = 10_000;

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

async function loadEvmWalletUsd(dataDir) {
  const row = await lastJsonlRow(join(dataDir, "treasury-inventory.jsonl"));
  const value = finite(row?.summary?.estimatedWalletUsd);
  return { source: "treasury-inventory.jsonl", valueUsd: value, observedAt: row?.observedAt || null };
}

async function loadEvmAutopilotUsd(dataDir) {
  const snapshot = await readJsonIfExists(join(dataDir, "all-chain-autopilot-latest.json"));
  const value = finite(snapshot?.summary?.capitalManager?.estimatedAssetValueUsd);
  return { source: "all-chain-autopilot-latest.json", valueUsd: value, observedAt: snapshot?.observedAt || null };
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

async function loadBtcL1Usd(dataDir, { liveFetch = true } = {}) {
  if (liveFetch) {
    const live = await loadBtcL1UsdLive();
    if (live.valueUsd != null) return live;
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
  return { source: "btc-nav-history.jsonl", valueUsd: value, observedAt: row?.observedAt || null, fallback: true };
}

async function loadClosedProtocolMarksUsd(dataDir) {
  const auditPairs = await lastJsonlRowsByStrategy(join(dataDir, "capital-audit-pairs.jsonl"));
  const closedStrategies = new Set();
  for (const [strategy, row] of auditPairs.entries()) {
    if (row?.status === "closed") closedStrategies.add(strategy);
  }
  const positions = await latestMarkPerPositionId(join(dataDir, "protocol-position-marks.jsonl"));
  let total = 0;
  let positionCount = 0;
  for (const mark of positions.values()) {
    if (mark.event !== "mark") continue;
    const valueUsd = finite(mark.valueUsd);
    if (valueUsd == null) continue;
    if (mark.strategyId && closedStrategies.size > 0 && !closedStrategies.has(mark.strategyId)) continue;
    total += valueUsd;
    positionCount += 1;
  }
  return {
    source: "protocol-position-marks.jsonl (closed audit-pair strategies only)",
    valueUsd: positionCount > 0 ? total : null,
    positionCount,
    note: "already included in evmAutopilotUsd via injectProtocolPositionsIntoLatestSnapshot; reported separately for audit",
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
} = {}) {
  const [evmWallet, evmAutopilot, bobL2Wbtc, btcL1, closedMarks] = await Promise.all([
    loadEvmWalletUsd(dataDir),
    loadEvmAutopilotUsd(dataDir),
    loadBobL2WbtcUsd(dataDir),
    loadBtcL1Usd(dataDir, { liveFetch: liveBtc }),
    loadClosedProtocolMarksUsd(dataDir),
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

  const unifiedNavUsd = evmAggregate != null && btcL1.valueUsd != null
    ? evmAggregate + btcL1.valueUsd
    : null;

  const flags = [];
  if (evmDiscrepancyFlag) flags.push(evmDiscrepancyFlag);
  if (missingSources.length > 0) flags.push("source_missing");

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
    halt: flags.includes("evm_source_disagreement") || flags.includes("source_missing"),
    breakdown: {
      evmWalletUsd: evmWallet,
      evmAutopilotUsd: evmAutopilot,
      bobL2WbtcUsd: bobL2Wbtc,
      btcL1Usd: btcL1,
      closedProtocolMarksUsd: closedMarks,
    },
  };
}

export function operatingCapitalUsdFromUnified(unified) {
  if (!unified || unified.halt) return null;
  return finite(unified.unifiedNavUsd);
}
