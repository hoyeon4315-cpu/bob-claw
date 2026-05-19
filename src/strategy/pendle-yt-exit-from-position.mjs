// True read-only exit-from-position EV producer for Pendle YT.
//
// This is the producer named `pendle_yt_exit_from_position` referenced by
// `lifecycle-evidence.mjs` and `next-legal-capital-action.mjs`. Unlike the
// pre-existing entry-side `evaluatePendleYtEv` (which uses a hypothetical
// $10 notional × APR × holdDays formula), this producer:
//
//   1. Reads the actual open YT position size from
//      `protocol-position-marks.jsonl` (`assetAmount`/`shareBalance` for
//      the matching `opportunityId + chain + pendle_market_swap + YT`).
//   2. Reads the Pendle fair-value exit quote (`ytPriceInAsset`,
//      `impliedApyDecimal`, `yearsToExpiry`) from the resolved binding on
//      the matching canary queue item (already populated by
//      `report-pendle-direct-canaries.mjs` from a real
//      `buildPendleOnChainExitQuote` call).
//   3. Reads the BTC/asset price the mark was observed at (`assetPriceUsd`).
//   4. Computes exit asset units = `ytAmount * ytPriceInAsset` and exit
//      USD value at the mark's `assetPriceUsd`.
//   5. Subtracts chain-specific exit + gas cost floor (from
//      `pendle-yt-ev.mjs::PENDLE_YT_EV_POLICY.chainCosts`).
//
// Output `expectedNetUsd` is the realized exit EV at current state. No
// signer, no key, no live execution.  The CLI dispatcher writes the
// result to `data/pendle-yt-exit-from-position-latest.json`; the selector
// pipeline passes it through to `buildLifecycleEvidence`.
//
// Failure modes are explicit: each opportunity reports `evidenced:true`
// only when every input field is present. Otherwise `evidenced:false`
// with `missingFields` listing the exact gap. The lifecycle envelope
// emits `status:"missing"` with `producerName:"pendle_yt_exit_from_position"`
// for any opp without an `evidenced:true` row.

import { PENDLE_YT_EV_POLICY } from "./pendle-yt-ev.mjs";

const PENDLE_PROTOCOL_ID = "pendle";
const PENDLE_YT_SYMBOL = "YT";

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
  if (mark && finite(mark.assetPriceUsd) === null) missingFields.push("mark_asset_price_usd");
  return missingFields;
}

function buildMissingResult({ opportunityId, chain, mark, missingFields, now }) {
  return {
    opportunityId,
    chain: chain || mark?.chain || null,
    evidenced: false,
    missingFields,
    producerName: "pendle_yt_exit_from_position",
    observedAt: mark?.observedAt || null,
    generatedAt: now,
  };
}

function buildEvidencedResult({ opportunityId, chain, mark, binding, exitQuote, costs, now }) {
  const ytAmount = finite(mark.assetAmount);
  const ytPriceInAsset = finite(exitQuote.ytPriceInAsset);
  const assetPriceUsd = finite(mark.assetPriceUsd);
  const exitAssetUnits = ytAmount * ytPriceInAsset;
  const exitGrossUsd = exitAssetUnits * assetPriceUsd;
  const costFloorUsd = costs.exitCostUsd + costs.gasCostUsd;
  return {
    opportunityId,
    chain: chain || mark.chain,
    evidenced: true,
    producerName: "pendle_yt_exit_from_position",
    ytAmount,
    ytPriceInAsset,
    assetPriceUsd,
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
  if (missingFields.length > 0) {
    return buildMissingResult({ opportunityId, chain, mark: inputs.mark, missingFields, now });
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
    results,
  };
}
