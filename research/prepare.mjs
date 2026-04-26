import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DAY_MS = 24 * 60 * 60 * 1000;

export const RESEARCH_GATEWAY_CHAINS = Object.freeze([
  "ethereum",
  "bob",
  "base",
  "bsc",
  "avalanche",
  "unichain",
  "bera",
  "optimism",
  "soneium",
  "sei",
  "sonic",
]);

const MUTATION_METHOD_PATTERN = /^(?:eth_send|eth_sign|personal_|wallet_|debug_|trace_|engine_)/u;

function normalizeChain(chain) {
  const value = String(chain || "").trim().toLowerCase();
  return {
    berachain: "bera",
    bnb: "bsc",
  }[value] || value;
}

function makeLcg(seed = 1) {
  let state = (Math.abs(Number(seed) || 1) % 2_147_483_647) || 1;
  return () => {
    state = (state * 48_271) % 2_147_483_647;
    return state / 2_147_483_647;
  };
}

function freezeRow(row) {
  return Object.freeze(row);
}

export function loadResearchPanel({ bars = 160, chains = ["base"], seed = 1 } = {}) {
  if (!Number.isInteger(bars) || bars <= 0) {
    throw new TypeError("bars must be a positive integer");
  }
  const normalizedChains = (Array.isArray(chains) && chains.length ? chains : ["base"]).map(normalizeChain);
  const rng = makeLcg(seed);
  const startMs = Date.parse("2024-01-01T00:00:00.000Z");
  const rows = [];
  let close = 100;
  for (let index = 0; index < bars; index += 1) {
    const seasonal = Math.sin(index / 6) * 0.006 + Math.cos(index / 17) * 0.002;
    const drift = 0.0035 + (index / bars) * 0.0007;
    const noise = (rng() - 0.5) * 0.006;
    const open = close;
    close = Math.max(1, close * (1 + drift + seasonal + noise));
    const high = Math.max(open, close) * (1 + Math.abs(noise) * 0.7);
    const low = Math.min(open, close) * (1 - Math.abs(noise) * 0.7);
    rows.push(
      freezeRow({
        index,
        tsMs: startMs + index * DAY_MS,
        observedAt: new Date(startMs + index * DAY_MS).toISOString(),
        chain: normalizedChains[index % normalizedChains.length],
        open: Number(open.toFixed(6)),
        high: Number(high.toFixed(6)),
        low: Number(low.toFixed(6)),
        close: Number(close.toFixed(6)),
        volume: Math.round(5_000 + rng() * 2_500 + index * 9),
      }),
    );
  }
  return Object.freeze({
    bars,
    chains: Object.freeze([...normalizedChains]),
    rows: Object.freeze(rows),
    generatedAt: new Date(startMs + (bars - 1) * DAY_MS).toISOString(),
  });
}

export function buildResearchSplits(
  panel,
  {
    foldCount = 4,
    trainSize = 32,
    valSize = 16,
    purgeSize = 1,
    embargoSize = 1,
  } = {},
) {
  const rows = panel?.rows || [];
  if (!rows.length) return Object.freeze([]);
  const requiredWindow = trainSize + purgeSize + valSize + embargoSize;
  if (requiredWindow > rows.length) return Object.freeze([]);
  const safeFoldCount = Math.max(1, Math.min(Number(foldCount) || 1, rows.length));
  const maxStart = rows.length - requiredWindow;
  const step = safeFoldCount === 1 ? 0 : Math.max(1, Math.floor(maxStart / (safeFoldCount - 1)));
  const splits = [];
  for (let index = 0; index < safeFoldCount; index += 1) {
    const trainStart = Math.min(index * step, maxStart);
    const trainEnd = trainStart + trainSize - 1;
    const valStart = trainEnd + purgeSize;
    const valEnd = valStart + valSize - 1;
    const embargoEnd = valEnd + embargoSize;
    if (embargoEnd > rows.length) break;
    splits.push(
      Object.freeze({
        id: `fold_${index}`,
        train: Object.freeze({ start: trainStart, end: trainEnd }),
        purgeSize,
        val: Object.freeze({ start: valStart, end: valEnd }),
        embargoEnd,
      }),
    );
  }
  return Object.freeze(splits);
}

export function loadRecordedRpcFixtures() {
  const raw = JSON.parse(readFileSync(join(HERE, "fixtures", "recorded-rpc.json"), "utf8"));
  return Object.freeze(raw);
}

export function assertRecordedRpcFixtureCoverage(fixtures = loadRecordedRpcFixtures()) {
  const chains = Object.keys(fixtures?.chains || {}).map(normalizeChain).sort((left, right) => left.localeCompare(right));
  const missing = RESEARCH_GATEWAY_CHAINS.filter((chain) => !chains.includes(chain));
  return Object.freeze({
    ok: missing.length === 0,
    chains: Object.freeze(chains),
    missing: Object.freeze(missing),
  });
}

function archiveRpcEnvName(chain) {
  return `RESEARCH_ARCHIVE_RPC_${normalizeChain(chain).toUpperCase().replace(/[^A-Z0-9]/gu, "_")}`;
}

export async function readOnlyArchiveRpc({ chain, method, params = [] } = {}) {
  const normalizedChain = normalizeChain(chain);
  if (!RESEARCH_GATEWAY_CHAINS.includes(normalizedChain)) {
    throw new Error(`unsupported research archive chain: ${chain}`);
  }
  if (!method || typeof method !== "string") {
    throw new TypeError("method is required");
  }
  if (MUTATION_METHOD_PATTERN.test(method)) {
    throw new Error(`blocked read-only research rpc method: ${method}`);
  }

  const rpcUrl = process.env[archiveRpcEnvName(normalizedChain)];
  if (rpcUrl) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });
    const body = await response.json();
    if (!response.ok || body.error) {
      throw new Error(body?.error?.message || `research archive rpc failed for ${normalizedChain}:${method}`);
    }
    return body.result;
  }

  const fixtures = loadRecordedRpcFixtures();
  const result = fixtures?.chains?.[normalizedChain]?.[method];
  if (result == null) {
    throw new Error(`missing recorded rpc fixture for ${normalizedChain}:${method}`);
  }
  return result;
}
