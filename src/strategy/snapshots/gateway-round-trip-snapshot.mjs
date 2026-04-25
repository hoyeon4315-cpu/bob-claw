// Gateway round-trip quote normalizer (pure).
//
// Shared by every adapter that bridges native BTC → destination
// asset and back. Takes two raw Gateway /v1/get-quote payloads
// (entry: BTC → destAsset, exit: destAsset → BTC) plus freshness
// timestamps, and produces the partial `market` slice that adapters
// consume:
//
//   { entrySlippageBps, exitSlippageBps, gatewayQuoteFresh,
//     gatewayRoundTripCostBps, offrampCostBps }
//
// Pure function. No I/O. Caller fetches the quotes through
// GatewayClient and passes raw response payloads in.
//
// Cost model (bps of input notional, BTC-denominated):
//   - slippageBps    = (marketValueUsd − outputUsd) / marketValueUsd
//   - feesBps        = (protocolFees + executionFees) / marketValueUsd
//   - sideTotalBps   = slippageBps + feesBps
//   - roundTripBps   = entrySideTotal + exitSideTotal
//   - offrampCostBps = exitSideTotal  (just the BTC-out leg)
//
// All ratios are computed from the quote itself (input × btcPriceUsd
// vs output), so the normalizer never trusts the quote's own slippage
// field — quotes lie about that surprisingly often.
//
// Output is frozen. Missing fields surface in `missing[]` instead of
// being defaulted to 0 (which would silently call a non-fresh route
// "free").

const SATS_PER_BTC = 100_000_000;
const USDC_DECIMALS = 6;
const DEFAULT_MAX_QUOTE_AGE_MS = 5 * 60 * 1000; // 5m

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ageMs(observedAt, now) {
  const t1 = Date.parse(observedAt);
  const t2 = Date.parse(now);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return t2 - t1;
}

function normalizeSide({
  payload,
  inputUnit,        // "sats" | "usdc"
  outputUnit,       // "sats" | "usdc"
  btcPriceUsd,
}) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "payload_missing" };
  }
  const inputAmount = finite(payload.inputAmount?.amount);
  const outputAmount = finite(payload.outputAmount?.amount);
  const protocolFees = finite(payload.fees?.amount) ?? 0;
  const executionFees = finite(payload.executionFees?.amount) ?? 0;
  if (inputAmount == null || outputAmount == null) {
    return { ok: false, reason: "amount_fields_missing" };
  }

  let inputUsd;
  if (inputUnit === "sats") {
    inputUsd = (inputAmount / SATS_PER_BTC) * btcPriceUsd;
  } else if (inputUnit === "usdc") {
    inputUsd = inputAmount / 10 ** USDC_DECIMALS;
  } else {
    return { ok: false, reason: "input_unit_unknown" };
  }
  let outputUsd;
  if (outputUnit === "sats") {
    outputUsd = (outputAmount / SATS_PER_BTC) * btcPriceUsd;
  } else if (outputUnit === "usdc") {
    outputUsd = outputAmount / 10 ** USDC_DECIMALS;
  } else {
    return { ok: false, reason: "output_unit_unknown" };
  }
  if (inputUsd <= 0) {
    return { ok: false, reason: "input_usd_non_positive" };
  }

  // Fees are reported in the destination unit (Gateway convention:
  // fees subtract from output side). Convert to USD with the same
  // unit as outputUnit.
  let feesUsd;
  if (outputUnit === "sats") {
    feesUsd = ((protocolFees + executionFees) / SATS_PER_BTC) * btcPriceUsd;
  } else {
    feesUsd = (protocolFees + executionFees) / 10 ** USDC_DECIMALS;
  }

  const slippageUsd = Math.max(0, inputUsd - outputUsd - feesUsd);
  const slippageBps = Math.round((slippageUsd / inputUsd) * 10_000);
  const feesBps = Math.round((feesUsd / inputUsd) * 10_000);
  const totalBps = slippageBps + feesBps;
  return {
    ok: true,
    inputUsd,
    outputUsd,
    feesUsd,
    slippageBps,
    feesBps,
    totalBps,
  };
}

export function normalizeGatewayRoundTripQuote({
  entryQuote = null,
  exitQuote = null,
  entryQuoteFetchedAt = null,
  exitQuoteFetchedAt = null,
  btcPriceUsd,
  now = new Date().toISOString(),
  maxQuoteAgeMs = DEFAULT_MAX_QUOTE_AGE_MS,
} = {}) {
  if (!Number.isFinite(btcPriceUsd) || btcPriceUsd <= 0) {
    throw new TypeError("btcPriceUsd must be a positive finite number");
  }

  const missing = [];

  const entry = normalizeSide({
    payload: entryQuote,
    inputUnit: "sats",
    outputUnit: "usdc",
    btcPriceUsd,
  });
  const exit = normalizeSide({
    payload: exitQuote,
    inputUnit: "usdc",
    outputUnit: "sats",
    btcPriceUsd,
  });

  if (!entry.ok) missing.push(`entry_quote_${entry.reason}`);
  if (!exit.ok) missing.push(`exit_quote_${exit.reason}`);

  const entryAge = ageMs(entryQuoteFetchedAt, now);
  const exitAge = ageMs(exitQuoteFetchedAt, now);
  if (entryAge == null) missing.push("entry_quote_age_unknown");
  if (exitAge == null) missing.push("exit_quote_age_unknown");

  const entryFresh = entry.ok && entryAge != null && entryAge >= 0
    && entryAge <= maxQuoteAgeMs;
  const exitFresh = exit.ok && exitAge != null && exitAge >= 0
    && exitAge <= maxQuoteAgeMs;
  const gatewayQuoteFresh = entryFresh && exitFresh;
  if (entry.ok && entryAge != null && !entryFresh) {
    missing.push("entry_quote_stale");
  }
  if (exit.ok && exitAge != null && !exitFresh) {
    missing.push("exit_quote_stale");
  }

  const entrySlippageBps = entry.ok ? entry.slippageBps : null;
  const exitSlippageBps = exit.ok ? exit.slippageBps : null;
  const gatewayRoundTripCostBps = entry.ok && exit.ok
    ? entry.totalBps + exit.totalBps
    : null;
  const offrampCostBps = exit.ok ? exit.totalBps : null;

  const market = Object.freeze({
    entrySlippageBps,
    exitSlippageBps,
    gatewayQuoteFresh,
    gatewayRoundTripCostBps,
    offrampCostBps,
  });

  return Object.freeze({
    schemaVersion: 1,
    fetchedAt: now,
    btcPriceUsd,
    maxQuoteAgeMs,
    sides: Object.freeze({
      entry: entry.ok
        ? Object.freeze({
            inputUsd: entry.inputUsd,
            outputUsd: entry.outputUsd,
            feesUsd: entry.feesUsd,
            slippageBps: entry.slippageBps,
            feesBps: entry.feesBps,
            totalBps: entry.totalBps,
            ageMs: entryAge,
            fresh: entryFresh,
          })
        : null,
      exit: exit.ok
        ? Object.freeze({
            inputUsd: exit.inputUsd,
            outputUsd: exit.outputUsd,
            feesUsd: exit.feesUsd,
            slippageBps: exit.slippageBps,
            feesBps: exit.feesBps,
            totalBps: exit.totalBps,
            ageMs: exitAge,
            fresh: exitFresh,
          })
        : null,
    }),
    market,
    partial: missing.length > 0,
    missing: Object.freeze(missing),
  });
}
