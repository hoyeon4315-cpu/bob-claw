import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

const DEFAULT_DIA_BASE_URL = "https://api.diadata.org/v1";
const DEFAULT_SYMBOLS = Object.freeze(["BTC", "cbBTC", "WETH", "USDC", "PAXG", "XAUt"]);

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function responseHash(body) {
  return createHash("sha256")
    .update(JSON.stringify(body ?? null))
    .digest("hex");
}

async function appendAuditRow(row, auditLogPath) {
  if (!auditLogPath) return;
  await mkdir(dirname(auditLogPath), { recursive: true });
  await appendFile(auditLogPath, `${JSON.stringify(row)}\n`);
}

function symbolToPriceFields(symbol, price) {
  const normalized = String(symbol || "").toLowerCase();
  if (normalized === "btc") {
    return { btc: price, tokenByKey: { btc: price, wbtc: price } };
  }
  if (normalized === "cbbtc") return { tokenByKey: { cbbtc: price } };
  if (normalized === "weth" || normalized === "eth") {
    return {
      tokenByKey: { ethereum: price },
      nativeByChain: { ethereum: price, base: price, bob: price, optimism: price, soneium: price, unichain: price },
    };
  }
  if (normalized === "usdc" || normalized === "usdt") return { tokenByKey: { usd_stable: price } };
  return { tokenByKey: { [normalized]: price } };
}

export function diaQuotationToPriceSnapshot(quotations = [], { observedAt = new Date().toISOString() } = {}) {
  const snapshot = {
    source: "dia",
    observedAt,
    btc: null,
    tokenByKey: {},
    nativeByChain: {},
  };
  for (const quote of quotations) {
    const price = finite(quote?.Price);
    if (price == null || price <= 0) continue;
    const mapped = symbolToPriceFields(quote.Symbol, price);
    if (Number.isFinite(mapped.btc)) snapshot.btc = mapped.btc;
    Object.assign(snapshot.tokenByKey, mapped.tokenByKey || {});
    Object.assign(snapshot.nativeByChain, mapped.nativeByChain || {});
  }
  if (!Number.isFinite(snapshot.btc) && Number.isFinite(snapshot.tokenByKey.btc)) {
    snapshot.btc = snapshot.tokenByKey.btc;
  }
  return snapshot;
}

export async function fetchDiaQuotationSnapshot({
  symbols = DEFAULT_SYMBOLS,
  fetchFn = globalThis.fetch,
  baseUrl = DEFAULT_DIA_BASE_URL,
  auditFn = null,
  auditLogPath = join("logs", "dia-feed-audit.jsonl"),
  now = new Date(),
} = {}) {
  const quotations = [];
  const observedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  for (const symbol of symbols) {
    const endpoint = `${baseUrl.replace(/\/$/, "")}/quotation/${encodeURIComponent(symbol)}`;
    try {
      const response = await fetchFn(endpoint, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json().catch(() => null);
      const auditRow = {
        ts: observedAt,
        endpoint: "/v1/quotation/{symbol}",
        paramsMasked: { symbol },
        status: response.status,
        responseHash: responseHash(body),
        decision: response.ok ? "sample_included" : "sample_omitted",
      };
      if (auditFn) await auditFn(auditRow);
      else await appendAuditRow(auditRow, auditLogPath);
      if (response.ok && body) quotations.push(body);
    } catch (err) {
      const auditRow = {
        ts: observedAt,
        endpoint: "/v1/quotation/{symbol}",
        paramsMasked: { symbol },
        status: "error",
        responseHash: null,
        decision: "sample_omitted",
        error: err && err.message ? err.message : String(err),
      };
      if (auditFn) await auditFn(auditRow);
      else await appendAuditRow(auditRow, auditLogPath);
    }
  }
  return diaQuotationToPriceSnapshot(quotations, { observedAt });
}

export const DIA_QUOTATION_SYMBOLS = DEFAULT_SYMBOLS;
