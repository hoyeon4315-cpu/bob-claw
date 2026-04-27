import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dexQuoteCacheTtlMs } from "../../config/discretionary-budget.mjs";

export const DEX_QUOTE_CACHE_PATH = fileURLToPath(
  new URL("../../../data/cache/dex-quote-cache.json", import.meta.url),
);

function cloneSerializable(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function positiveAmountString(amount) {
  if (typeof amount === "bigint") {
    if (amount <= 0n) throw new Error("DEX quote amount must be positive");
    return amount.toString();
  }
  const normalized = String(amount ?? "").trim();
  if (!/^[0-9]+$/u.test(normalized)) {
    throw new Error("DEX quote amount must be an integer string");
  }
  const compact = normalized.replace(/^0+/u, "") || "0";
  if (compact === "0") throw new Error("DEX quote amount must be positive");
  return compact;
}

export function dexQuoteAmountBucket(amount) {
  const normalized = positiveAmountString(amount);
  if (normalized.length <= 15) {
    return Math.round(Math.log10(Number(normalized)));
  }
  const significantDigits = 15;
  const prefix = Number(normalized.slice(0, significantDigits));
  const magnitude = normalized.length - significantDigits;
  return Math.round(Math.log10(prefix) + magnitude);
}

export function dexQuoteCacheKey({ routeKey, amountBucket, srcChain } = {}) {
  const normalizedRouteKey = String(routeKey || "").trim();
  const normalizedSrcChain = String(srcChain || "").trim().toLowerCase();
  if (!normalizedRouteKey) throw new Error("DEX quote cache routeKey is required");
  if (!normalizedSrcChain) throw new Error("DEX quote cache srcChain is required");
  if (!Number.isInteger(amountBucket)) throw new Error("DEX quote cache amountBucket must be an integer");
  return `${normalizedSrcChain}:${normalizedRouteKey}:${amountBucket}`;
}

function normalizeEntry(entry = {}) {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.cacheKey !== "string" || !entry.cacheKey) return null;
  if (!Number.isInteger(entry.amountBucket)) return null;
  if (typeof entry.routeKey !== "string" || !entry.routeKey) return null;
  if (typeof entry.srcChain !== "string" || !entry.srcChain) return null;
  if (typeof entry.observedAt !== "string" || !entry.observedAt) return null;
  return {
    cacheKey: entry.cacheKey,
    routeKey: entry.routeKey,
    srcChain: entry.srcChain,
    amountBucket: entry.amountBucket,
    observedAt: entry.observedAt,
    value: cloneSerializable(entry.value),
  };
}

export class DexQuoteCache {
  constructor({
    cachePath = DEX_QUOTE_CACHE_PATH,
    ttlMs = dexQuoteCacheTtlMs,
  } = {}) {
    this.cachePath = cachePath;
    this.ttlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : dexQuoteCacheTtlMs;
    this.loaded = false;
    this.entries = new Map();
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    let parsed = null;
    try {
      parsed = JSON.parse(await readFile(this.cachePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    const rawEntries = Array.isArray(parsed?.entries)
      ? parsed.entries
      : parsed?.entries && typeof parsed.entries === "object"
        ? Object.values(parsed.entries)
        : [];
    for (const rawEntry of rawEntries) {
      const entry = normalizeEntry(rawEntry);
      if (!entry) continue;
      this.entries.set(entry.cacheKey, entry);
    }
  }

  async persist() {
    await mkdir(dirname(this.cachePath), { recursive: true });
    const entries = [...this.entries.values()].sort((left, right) => left.cacheKey.localeCompare(right.cacheKey));
    await writeFile(
      this.cachePath,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        entries,
      }, null, 2),
      "utf8",
    );
  }

  buildLookup({ routeKey, amount, srcChain } = {}) {
    const amountBucket = dexQuoteAmountBucket(amount);
    const cacheKey = dexQuoteCacheKey({ routeKey, amountBucket, srcChain });
    return {
      cacheKey,
      amountBucket,
      routeKey: String(routeKey).trim(),
      srcChain: String(srcChain).trim().toLowerCase(),
    };
  }

  async get({ routeKey, amount, srcChain, now = new Date().toISOString() } = {}) {
    await this.load();
    const lookup = this.buildLookup({ routeKey, amount, srcChain });
    const entry = this.entries.get(lookup.cacheKey);
    if (!entry) return null;
    const ageMs = new Date(now).getTime() - new Date(entry.observedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > this.ttlMs) {
      return null;
    }
    return {
      ...entry,
      value: cloneSerializable(entry.value),
      ttlMs: this.ttlMs,
      ageMs,
    };
  }

  async set({ routeKey, amount, srcChain, value, observedAt = new Date().toISOString() } = {}) {
    await this.load();
    const lookup = this.buildLookup({ routeKey, amount, srcChain });
    const entry = {
      ...lookup,
      observedAt,
      value: cloneSerializable(value),
    };
    this.entries.set(lookup.cacheKey, entry);
    await this.persist();
    return {
      ...entry,
      ttlMs: this.ttlMs,
      ageMs: 0,
      value: cloneSerializable(entry.value),
    };
  }
}

let sharedDexQuoteCache = null;

export function defaultDexQuoteCache() {
  if (!sharedDexQuoteCache) {
    sharedDexQuoteCache = new DexQuoteCache();
  }
  return sharedDexQuoteCache;
}
