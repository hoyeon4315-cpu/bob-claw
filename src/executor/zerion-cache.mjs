// Zerion API cache layer
// Handles rate limiting with caching, exponential backoff, and graceful fallback.
//
// Rate limit info (Zerion free tier):
// - 1,000 requests/day
// - ~42 requests/hour max
// → We cache for 1h and only refresh on demand.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const API_KEY = process.env.BOB_CLAW_ZERION_API_KEY || "";
const BASE_URL = "https://api.zerion.io/v1";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_PATH = "data/zerion/positions-cache.json";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

function authHeader() {
  if (!API_KEY) return null;
  // Zerion uses Basic auth with API key as username, empty password
  const encoded = Buffer.from(API_KEY + ":").toString("base64");
  return `Basic ${encoded}`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchZerionWithRetry(address, attempt = 1) {
  const url = `${BASE_URL}/wallets/${address}/positions?currency=usd&filter[positions]=only_simple&sort=value`;
  const headers = {
    Accept: "application/json",
  };
  const auth = authHeader();
  if (auth) headers.Authorization = auth;

  try {
    const res = await fetch(url, { headers });

    if (res.status === 429) {
      if (attempt > MAX_RETRIES) {
        return { ok: false, error: "rate_limit_exhausted", status: 429 };
      }
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.error(`Zerion 429, retrying in ${backoff}ms (attempt ${attempt}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchZerionWithRetry(address, attempt + 1);
    }

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `http_${res.status}`, details: text, status: res.status };
    }

    const data = await res.json();
    return { ok: true, data, fetchedAt: Date.now() };
  } catch (e) {
    if (attempt > MAX_RETRIES) {
      return { ok: false, error: "network_error", details: e.message };
    }
    const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
    console.error(`Zerion network error, retrying in ${backoff}ms: ${e.message}`);
    await sleep(backoff);
    return fetchZerionWithRetry(address, attempt + 1);
  }
}

async function readCache() {
  try {
    const raw = await readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const ageMs = Date.now() - (parsed.cachedAt || 0);
    return { ...parsed, ageMs, stale: ageMs > CACHE_TTL_MS };
  } catch {
    return null;
  }
}

async function writeCache(payload) {
  try {
    await mkdir(dirname(CACHE_PATH), { recursive: true });
    await writeFile(CACHE_PATH, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error("Failed to write Zerion cache:", e.message);
  }
}

export async function fetchZerionPositions(address, { forceRefresh = false } = {}) {
  // 1. Check cache first
  const cache = await readCache();

  if (!forceRefresh && cache && !cache.stale) {
    return {
      source: "cache",
      cachedAt: cache.cachedAt,
      ageMs: cache.ageMs,
      positions: cache.positions || [],
      totalValue: cache.totalValue || 0,
      positionValue: cache.positionValue || 0,
      tokenValue: cache.tokenValue || 0,
    };
  }

  // 2. Try API with retry/backoff
  const apiResult = await fetchZerionWithRetry(address);

  if (apiResult.ok) {
    // Parse and cache
    const positions = (apiResult.data.data || []).map((pos) => {
      const attrs = pos.attributes || {};
      return {
        id: pos.id,
        chain: attrs.chain || "?",
        symbol: attrs.fungible_info?.symbol || attrs.symbol || "?",
        name: attrs.fungible_info?.name || attrs.name || "Unknown",
        value: attrs.value || 0,
        quantity: attrs.quantity?.float || 0,
        price: attrs.price || 0,
        isPosition: Boolean(attrs.position_type),
        positionType: attrs.position_type || null,
        apy: attrs.apy || null,
        protocol: attrs.protocol || null,
      };
    });

    const totalValue = positions.reduce((s, p) => s + p.value, 0);
    const positionValue = positions.filter((p) => p.isPosition).reduce((s, p) => s + p.value, 0);
    const tokenValue = positions.filter((p) => !p.isPosition).reduce((s, p) => s + p.value, 0);

    const payload = {
      cachedAt: Date.now(),
      address,
      positions,
      totalValue,
      positionValue,
      tokenValue,
    };

    await writeCache(payload);

    return {
      source: "api",
      cachedAt: payload.cachedAt,
      ageMs: 0,
      positions,
      totalValue,
      positionValue,
      tokenValue,
    };
  }

  // 3. Fallback to stale cache if available
  if (cache) {
    console.error(`Zerion API failed (${apiResult.error}), falling back to stale cache`);
    return {
      source: "stale_cache",
      cachedAt: cache.cachedAt,
      ageMs: cache.ageMs,
      positions: cache.positions || [],
      totalValue: cache.totalValue || 0,
      positionValue: cache.positionValue || 0,
      tokenValue: cache.tokenValue || 0,
      apiError: apiResult.error,
    };
  }

  // 4. Complete failure
  return {
    source: "failed",
    positions: [],
    totalValue: 0,
    positionValue: 0,
    tokenValue: 0,
    apiError: apiResult.error,
  };
}

// CLI for manual refresh
async function main() {
  const address = process.argv[2] || "0x96262bE63AA687563789225c2fE898c27a3b0AE4";
  const force = process.argv.includes("--force");

  console.error(`Fetching Zerion positions for ${address}...`);
  const result = await fetchZerionPositions(address, { forceRefresh: force });

  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
