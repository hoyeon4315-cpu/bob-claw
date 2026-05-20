// True read-only exit-from-position EV producer for Pendle YT.
//
// This producer never emits `evidenced:true` unless every dimensional
// invariant for the valuation chain is explicitly proven by the inputs
// (no implicit assumptions, no full-underlying USD price reused as a per-YT
// USD price, no stale fair-value-only quote without a current-quote
// attestation). When the invariant fails, the producer emits
// `evidenced:false` with `invalidFields` listing exact dimensional gaps
// and/or `missingFields` listing missing inputs. The lifecycle envelope
// surfaces both lists so downstream consumers can route hold/incomplete
// rather than dispatch a fabricated exit.
//
// Inputs (per opportunity):
//   1. Latest open Pendle YT position mark from
//      `protocol-position-marks.jsonl`. Must carry: `assetAmount`,
//      `assetSymbol=YT`, `assetDecimals`, `underlyingAssetSymbol`,
//      `underlyingAssetPriceUsd`, and `valuationProvenance`.
//   2. Resolved binding `exitQuote` from `merkl-canary-queue.json` for the
//      same opportunity. Must carry: `ytPriceInAsset`, `unit="asset_per_yt"`,
//      `quotedAt` (ISO), and `quoteIntent` in {"yt_market_swap","yt_redeem"}.
//   3. Chain-specific exit + gas cost floor from `pendle-yt-ev.mjs`.
//
// Formula (only when invariant holds):
//   exitAssetUnits = ytAmount × ytPriceInAsset
//   exitGrossUsd   = exitAssetUnits × underlyingAssetPriceUsd
//   costFloorUsd   = chainCosts[chain].exit + chainCosts[chain].gas
//   expectedNetUsd = exitGrossUsd − costFloorUsd
//
// Anti-overfit: no opportunityId, market address, or dollar ceiling is
// hardcoded. The invariant rejects (a) marks that misuse the underlying
// asset's full USD price as the YT's `assetPriceUsd`, (b) exit quotes
// that lack explicit per-YT unit declaration or current-quote
// attestation, and (c) any combination producing a per-YT USD price
// strictly greater than the underlying USD price.

import { PENDLE_YT_EV_POLICY } from "./pendle-yt-ev.mjs";

const PENDLE_PROTOCOL_ID = "pendle";
const PENDLE_YT_SYMBOL = "YT";
const ALLOWED_VALUATION_PROVENANCE = new Set(["current_position_onchain", "position_reader_verified_current"]);
const ALLOWED_QUOTE_INTENTS = new Set(["yt_market_swap", "yt_redeem"]);
const ALLOWED_QUOTE_UNIT = "asset_per_yt";
const MISAPPLIED_PRICE_REL_TOLERANCE = 1e-3;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function lower(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isOpenPendleYtMark(record) {
  if (!record || record.event !== "position_marked") return false;
  if (lower(record.protocolId) !== PENDLE_PROTOCOL_ID) return false;
  if (lower(record.assetSymbol) !== lower(PENDLE_YT_SYMBOL)) return false;
  if (record.status && record.status !== "open") return false;
  return true;
}

function latestPendleYtMark(records, { opportunityId, chain }) {
  let latest = null;
  for (const record of Array.isArray(records) ? records : []) {
    if (!isOpenPendleYtMark(record)) continue;
    if (record.opportunityId !== opportunityId) continue;
    if (chain && record.chain && record.chain !== chain) continue;
    if (!latest || String(record.observedAt) > String(latest.observedAt)) latest = record;
  }
  return latest;
}

function queueItemFor(queue, opportunityId) {
  const rows = Array.isArray(queue?.queue) ? queue.queue : [];
  for (const row of rows) {
    if (row && row.opportunityId === opportunityId) return row;
  }
  return null;
}

function bindingOf(queueItem) {
  return queueItem?.protocolBindingPlan?.resolvedBinding || queueItem?.protocolBinding || null;
}

function exitQuoteOf(queueItem, binding) {
  return binding?.exitQuote || queueItem?.ytExitQuote || queueItem?.exitQuote || null;
}

function chainCostFloor(chain) {
  const profile = PENDLE_YT_EV_POLICY.chainCosts?.[lower(chain)] || null;
  if (!profile) {
    return {
      profile: "default",
      exitCostUsd: PENDLE_YT_EV_POLICY.defaultExitCostUsd,
      gasCostUsd: PENDLE_YT_EV_POLICY.defaultGasCostUsd,
    };
  }
  return { profile: lower(chain), exitCostUsd: profile.exit, gasCostUsd: profile.gas };
}

function collectInputs({ opportunityId, chain, protocolPositionMarks, canaryQueue }) {
  const mark = latestPendleYtMark(protocolPositionMarks, { opportunityId, chain });
  const queueItem = canaryQueue ? queueItemFor(canaryQueue, opportunityId) : null;
  const binding = queueItem ? bindingOf(queueItem) : null;
  const exitQuote = exitQuoteOf(queueItem, binding);
  return { mark, queueItem, binding, exitQuote };
}

function validateInputs({ mark, queueItem, binding, exitQuote }) {
  const missingFields = [];
  if (!mark) missingFields.push("position_mark");
  if (!queueItem) missingFields.push("canary_queue_item");
  if (!binding) missingFields.push("resolved_binding");
  if (!exitQuote) missingFields.push("binding_exit_quote");
  if (mark && finite(mark.assetAmount) === null) missingFields.push("mark_asset_amount");
  if (exitQuote && finite(exitQuote.ytPriceInAsset) === null) missingFields.push("yt_price_in_asset");
  return missingFields;
}

function validateMarkInvariant(mark, invalidFields) {
  if (!mark) return;
  if (finite(mark.assetDecimals) === null) invalidFields.push("mark_asset_decimals_missing");
  if (!mark.underlyingAssetSymbol) invalidFields.push("mark_underlying_asset_symbol_missing");
  if (finite(mark.underlyingAssetPriceUsd) === null) invalidFields.push("mark_underlying_asset_price_usd_missing");
  if (!mark.valuationProvenance) {
    invalidFields.push("mark_valuation_provenance_missing");
  } else if (!ALLOWED_VALUATION_PROVENANCE.has(mark.valuationProvenance)) {
    invalidFields.push("mark_valuation_provenance_not_current_position");
  }
  const underlyingPx = finite(mark.underlyingAssetPriceUsd);
  const assetPx = finite(mark.assetPriceUsd);
  if (
    lower(mark.assetSymbol) === lower(PENDLE_YT_SYMBOL) &&
    underlyingPx !== null &&
    underlyingPx > 0 &&
    assetPx !== null &&
    Math.abs(assetPx - underlyingPx) / underlyingPx < MISAPPLIED_PRICE_REL_TOLERANCE
  ) {
    invalidFields.push("mark_asset_price_usd_misapplies_underlying_full_price");
  }
}

function validateQuoteInvariant(exitQuote, invalidFields) {
  if (!exitQuote) return;
  if (exitQuote.unit !== ALLOWED_QUOTE_UNIT) invalidFields.push("exit_quote_unit_not_asset_per_yt");
  if (!exitQuote.quotedAt) invalidFields.push("exit_quote_quoted_at_missing");
  if (!exitQuote.quoteIntent) {
    invalidFields.push("exit_quote_intent_missing");
  } else if (!ALLOWED_QUOTE_INTENTS.has(exitQuote.quoteIntent)) {
    invalidFields.push("exit_quote_intent_not_yt_redeem_or_swap");
  }
}

function validateDimensionalSanity(mark, exitQuote, invalidFields) {
  const ytPx = finite(exitQuote?.ytPriceInAsset);
  const underlyingPx = finite(mark?.underlyingAssetPriceUsd);
  if (ytPx === null || underlyingPx === null || underlyingPx <= 0) return;
  const perYtUsd = ytPx * underlyingPx;
  if (perYtUsd > underlyingPx) invalidFields.push("yt_price_usd_per_token_exceeds_underlying");
  if (ytPx < 0) invalidFields.push("yt_price_in_asset_negative");
  if (ytPx > 1) invalidFields.push("yt_price_in_asset_exceeds_one");
}

function dimensionalInvariant(mark, exitQuote) {
  const invalidFields = [];
  validateMarkInvariant(mark, invalidFields);
  validateQuoteInvariant(exitQuote, invalidFields);
  validateDimensionalSanity(mark, exitQuote, invalidFields);
  return invalidFields;
}

function buildIncompleteResult({ opportunityId, chain, mark, missingFields, invalidFields, now }) {
  return {
    opportunityId,
    chain: chain || mark?.chain || null,
    evidenced: false,
    missingFields,
    invalidFields,
    producerName: "pendle_yt_exit_from_position",
    observedAt: mark?.observedAt || null,
    generatedAt: now,
  };
}

function buildEvidencedResult({ opportunityId, chain, mark, binding, exitQuote, costs, now }) {
  const ytAmount = finite(mark.assetAmount);
  const ytPriceInAsset = finite(exitQuote.ytPriceInAsset);
  const underlyingAssetPriceUsd = finite(mark.underlyingAssetPriceUsd);
  const exitAssetUnits = ytAmount * ytPriceInAsset;
  const exitGrossUsd = exitAssetUnits * underlyingAssetPriceUsd;
  const costFloorUsd = costs.exitCostUsd + costs.gasCostUsd;
  return {
    opportunityId,
    chain: chain || mark.chain,
    evidenced: true,
    producerName: "pendle_yt_exit_from_position",
    ytAmount,
    ytPriceInAsset,
    assetDecimals: finite(mark.assetDecimals),
    underlyingAssetSymbol: mark.underlyingAssetSymbol,
    underlyingAssetPriceUsd,
    assetPriceUsd: finite(mark.assetPriceUsd),
    valuationProvenance: mark.valuationProvenance,
    quoteUnit: exitQuote.unit,
    quoteIntent: exitQuote.quoteIntent,
    quotedAt: exitQuote.quotedAt,
    impliedApyDecimal: finite(exitQuote.impliedApyDecimal),
    yearsToExpiry: finite(exitQuote.yearsToExpiry),
    ytPriceSource: exitQuote.source || null,
    onChainConfirmed: Boolean(exitQuote.onChainConfirmed),
    exitAssetUnits,
    exitGrossUsd,
    exitCostUsd: costs.exitCostUsd,
    gasCostUsd: costs.gasCostUsd,
    costFloorUsd,
    expectedNetUsd: exitGrossUsd - costFloorUsd,
    chainCostProfile: costs.profile,
    markObservedAt: mark.observedAt || null,
    markFreshness: mark.freshness || null,
    markPositionId: mark.positionId || null,
    walletAddress: mark.walletAddress || null,
    marketAddress: binding?.marketAddress || null,
    ytTokenAddress: binding?.ytTokenAddress || null,
    maturity: binding?.maturity || binding?.ytExpiry || null,
    observedAt: mark.observedAt || null,
    generatedAt: now,
  };
}

export function computePendleYtExitFromPosition({
  opportunityId,
  chain,
  protocolPositionMarks = [],
  canaryQueue = null,
  now = new Date().toISOString(),
}) {
  const inputs = collectInputs({ opportunityId, chain, protocolPositionMarks, canaryQueue });
  const missingFields = validateInputs(inputs);
  const invalidFields = missingFields.length === 0 ? dimensionalInvariant(inputs.mark, inputs.exitQuote) : [];
  if (missingFields.length > 0 || invalidFields.length > 0) {
    return buildIncompleteResult({
      opportunityId,
      chain,
      mark: inputs.mark,
      missingFields,
      invalidFields,
      now,
    });
  }
  const costs = chainCostFloor(chain || inputs.mark.chain);
  return buildEvidencedResult({ opportunityId, chain, ...inputs, costs, now });
}

function uniqueOpenPendleYtOpps(protocolPositionMarks) {
  const seen = new Map();
  for (const record of Array.isArray(protocolPositionMarks) ? protocolPositionMarks : []) {
    if (!isOpenPendleYtMark(record)) continue;
    const key = `${record.opportunityId}::${record.chain}`;
    const previous = seen.get(key);
    if (!previous || String(record.observedAt) > String(previous.observedAt)) seen.set(key, record);
  }
  return [...seen.values()].map((m) => ({ opportunityId: m.opportunityId, chain: m.chain }));
}

export function buildPendleYtExitFromPositionReport({
  protocolPositionMarks = [],
  canaryQueue = null,
  now = new Date().toISOString(),
}) {
  const opps = uniqueOpenPendleYtOpps(protocolPositionMarks);
  const results = opps.map(({ opportunityId, chain }) =>
    computePendleYtExitFromPosition({ opportunityId, chain, protocolPositionMarks, canaryQueue, now }),
  );
  results.sort((a, b) => {
    if (a.evidenced !== b.evidenced) return a.evidenced ? -1 : 1;
    return (b.expectedNetUsd ?? -Infinity) - (a.expectedNetUsd ?? -Infinity);
  });
  return {
    schemaVersion: 1,
    generatedAt: now,
    producerName: "pendle_yt_exit_from_position",
    runtimeAuthority: "policy_engine_only",
    broadcastMode: "read_only_no_signer_dispatch",
    openPositionCount: results.length,
    evidencedCount: results.filter((r) => r.evidenced).length,
    invalidCount: results.filter((r) => Array.isArray(r.invalidFields) && r.invalidFields.length > 0).length,
    results,
  };
}
