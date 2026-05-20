// Pure deterministic producer for the per-candidate `lifecycleEvidence`
// envelope. Common-structure across every DEPLOYMENT_SELECTOR_FAMILIES
// family. Reads only from upstream report artefacts already collected
// by `run-all-source-deployment-selector.mjs` and never touches signer,
// keys, or live RPCs.
//
// Evidence keys (matching HOLD_LIFECYCLE_EVIDENCE_REQUIREMENTS in
// next-legal-capital-action.mjs):
//   position_health
//   position_maturity_or_redeemability
//   exit_or_redeem_ev
//   claimable_or_harvest_amount
//   receipt_or_closed_at_state
//   cost_floor
//
// Each entry on the envelope is `{status, value, provenance, observedAt}`
// where `status` ∈ {"evidenced","proxy","not_applicable","missing"}. Missing
// keys are surfaced explicitly so the mapper can emit hold(incomplete_evidence)
// with the exact unmet producer names rather than a vague NO_TRADE.
//
// `proxy` is a narrowly-allowed third state for fields where the only
// available signal is a structurally related but not source-of-truth
// computation (e.g. Pendle YT entry-side dry-run EV reused as an exit-side
// estimate). Proxy values carry `provenanceKind` and `producerName` so the
// mapper and downstream surfaces can distinguish them from real evidence.
// The mapper treats `proxy` as not-evidenced for the purpose of
// `evidenceComplete`, unless a future explicit policy opt-in flips it.
//
// The true exit-side producer for Pendle YT is
// `pendle_yt_exit_from_position` (see
// `src/strategy/pendle-yt-exit-from-position.mjs` and its CLI
// `src/cli/report-pendle-yt-exit-from-position.mjs`). When that producer
// emits `evidenced:true` for an opportunity, `buildExitRedeemEv` returns
// `status:"evidenced"` with `provenanceKind:"true_exit_ev"` and the cost
// floor slot also flips to the chain-specific exit+gas costs sourced from
// the same producer.

const LIFECYCLE_KEYS = Object.freeze([
  "position_health",
  "position_maturity_or_redeemability",
  "exit_or_redeem_ev",
  "claimable_or_harvest_amount",
  "receipt_or_closed_at_state",
  "cost_floor",
]);

const POSITION_MARK_FRESHNESS_MAX_MS = 6 * 60 * 60 * 1000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function emptyEvidence() {
  const envelope = {};
  for (const key of LIFECYCLE_KEYS) {
    envelope[key] = { status: "missing", value: null, provenance: null, observedAt: null };
  }
  return envelope;
}

function latestProtocolPositionMark(records, { opportunityId, chain, walletAddress }) {
  let latest = null;
  for (const record of asArray(records)) {
    if (!record || record.event !== "position_marked") continue;
    if (opportunityId && record.opportunityId !== opportunityId) continue;
    if (chain && record.chain && record.chain !== chain) continue;
    if (walletAddress && record.walletAddress && record.walletAddress.toLowerCase() !== walletAddress.toLowerCase())
      continue;
    if (!latest || String(record.observedAt) > String(latest.observedAt)) latest = record;
  }
  return latest;
}

function pendleDryRunResultFor(pendleYtDryRun, opportunityId) {
  if (!pendleYtDryRun || !Array.isArray(pendleYtDryRun.results)) return null;
  for (const row of pendleYtDryRun.results) {
    if (row && row.opportunityId === opportunityId) return row;
  }
  return null;
}

function pendleYtExitFromPositionFor(report, opportunityId) {
  if (!report || !Array.isArray(report.results)) return null;
  for (const row of report.results) {
    if (row && row.opportunityId === opportunityId) return row;
  }
  return null;
}

function buildPositionHealth(mark, now) {
  if (!mark) return { status: "missing", value: null, provenance: "protocol-position-marks.jsonl", observedAt: null };
  const observedAtMs = Date.parse(mark.observedAt || "");
  const nowMs = Date.parse(now || new Date().toISOString());
  const ageMs = Number.isFinite(observedAtMs) && Number.isFinite(nowMs) ? nowMs - observedAtMs : null;
  const stale = ageMs !== null && ageMs > POSITION_MARK_FRESHNESS_MAX_MS;
  return {
    status: "evidenced",
    value: {
      status: mark.status || null,
      shareBalance: mark.shareBalance ?? null,
      assetAmount: finiteNumber(mark.assetAmount),
      assetSymbol: mark.assetSymbol || null,
      healthFactor: finiteNumber(mark.healthFactor),
      freshness: stale ? "stale" : mark.freshness || null,
      confidence: mark.confidence || null,
      ageMs,
    },
    provenance: "protocol-position-marks.jsonl",
    observedAt: mark.observedAt || null,
  };
}

function buildMaturity(pendleResult, mark, now) {
  if (pendleResult && pendleResult.maturity) {
    const nowMs = Date.parse(now || new Date().toISOString());
    const maturityMs = Date.parse(pendleResult.maturity);
    const matured = Number.isFinite(maturityMs) && Number.isFinite(nowMs) && maturityMs <= nowMs;
    return {
      status: "evidenced",
      value: {
        maturity: pendleResult.maturity,
        maturityHours: finiteNumber(pendleResult.ev?.maturityHours ?? pendleResult.maturityHours),
        holdDays: finiteNumber(pendleResult.ev?.holdDays ?? pendleResult.holdDays),
        matured,
        redeemable: matured,
      },
      provenance: "pendle-yt-dry-run-latest.json",
      observedAt: pendleResult.generatedAt || pendleResult.observedAt || null,
    };
  }
  if (mark && mark.protocolId && mark.protocolId !== "pendle") {
    return {
      status: "not_applicable",
      value: { reason: `${mark.protocolId}_position_has_no_maturity` },
      provenance: "protocol-position-marks.jsonl",
      observedAt: mark.observedAt || null,
    };
  }
  return { status: "missing", value: null, provenance: "pendle-yt-dry-run-latest.json", observedAt: null };
}

function buildTrueExitEv(trueExitFromPosition) {
  const t = trueExitFromPosition;
  return {
    status: "evidenced",
    value: {
      expectedNetUsd: finiteNumber(t.expectedNetUsd),
      exitGrossUsd: finiteNumber(t.exitGrossUsd),
      exitAssetUnits: finiteNumber(t.exitAssetUnits),
      ytAmount: finiteNumber(t.ytAmount),
      ytPriceInAsset: finiteNumber(t.ytPriceInAsset),
      assetPriceUsd: finiteNumber(t.assetPriceUsd),
      impliedApyDecimal: finiteNumber(t.impliedApyDecimal),
      yearsToExpiry: finiteNumber(t.yearsToExpiry),
      ytPriceSource: t.ytPriceSource || null,
      onChainConfirmed: Boolean(t.onChainConfirmed),
      chainCostProfile: t.chainCostProfile || null,
      exitCostUsd: finiteNumber(t.exitCostUsd),
      gasCostUsd: finiteNumber(t.gasCostUsd),
      costFloorUsd: finiteNumber(t.costFloorUsd),
      provenanceKind: "true_exit_ev",
      producerName: t.producerName || "pendle_yt_exit_from_position",
    },
    provenance: "pendle-yt-exit-from-position-latest.json::true_exit_ev",
    observedAt: t.observedAt || t.generatedAt || null,
  };
}

function buildProxyExitEv(pendleResult, trueExitFromPosition) {
  const ev = pendleResult.ev;
  return {
    status: "proxy",
    value: {
      expectedNetUsd: finiteNumber(ev.expectedNetUsd),
      exitQuoteOutputUsd: finiteNumber(ev.exitQuote?.outputUsd),
      exitQuoteDepthUsd: finiteNumber(ev.exitQuote?.depthUsd),
      exitQuoteSlippageBps: finiteNumber(ev.exitQuote?.slippageBps),
      exitQuoteSource: ev.exitQuote?.source || null,
      evStatus: ev.status || null,
      provenanceKind: "entry_canary_ev_proxy",
      proxyAcceptedByPolicy: false,
      trueExitProducerName: "pendle_yt_exit_from_position",
      trueProducerMissingFields: trueExitFromPosition?.missingFields || null,
      trueProducerInvalidFields: trueExitFromPosition?.invalidFields || null,
    },
    provenance: "pendle-yt-dry-run-latest.json::entry_canary_ev_proxy",
    observedAt: pendleResult.generatedAt || null,
  };
}

function buildMissingExitEv(mark, trueExitFromPosition) {
  const producerName =
    mark?.protocolId === "pendle" ? "pendle_yt_exit_from_position" : "exit_ev_producer_for_non_pendle_protocol";
  return {
    status: "missing",
    value: {
      provenanceKind: "missing_exit_ev_producer",
      producerName,
      missingFields: trueExitFromPosition?.missingFields || null,
      invalidFields: trueExitFromPosition?.invalidFields || null,
    },
    provenance: producerName,
    observedAt: null,
  };
}

function buildExitRedeemEv(pendleResult, mark, trueExitFromPosition) {
  if (trueExitFromPosition && trueExitFromPosition.evidenced) return buildTrueExitEv(trueExitFromPosition);
  if (pendleResult && pendleResult.ev) return buildProxyExitEv(pendleResult, trueExitFromPosition);
  return buildMissingExitEv(mark, trueExitFromPosition);
}

function buildClaimable(merklUserRewards, mark) {
  if (mark && mark.protocolId === "pendle") {
    return {
      status: "not_applicable",
      value: { reason: "pendle_yt_yield_is_implicit_at_redemption" },
      provenance: "protocol_semantics",
      observedAt: mark.observedAt || null,
    };
  }
  if (merklUserRewards && Array.isArray(merklUserRewards.claimPlan?.chains)) {
    const totalClaimable = finiteNumber(merklUserRewards.totalClaimableUsd, 0);
    return {
      status: "evidenced",
      value: {
        totalClaimableUsd: totalClaimable,
        totalPendingUsd: finiteNumber(merklUserRewards.totalPendingUsd, 0),
        claimPlanStatus: merklUserRewards.claimPlan.status || null,
        readyChainCount: finiteNumber(merklUserRewards.claimPlan.readyChainCount, 0),
        blockedChainCount: finiteNumber(merklUserRewards.claimPlan.blockedChainCount, 0),
      },
      provenance: "merkl-user-rewards-latest.json",
      observedAt: merklUserRewards.observedAt || merklUserRewards.generatedAt || null,
    };
  }
  return { status: "missing", value: null, provenance: "merkl-user-rewards-latest.json", observedAt: null };
}

function buildReceiptClosedAt(mark) {
  if (!mark) return { status: "missing", value: null, provenance: "protocol-position-marks.jsonl", observedAt: null };
  return {
    status: "evidenced",
    value: {
      status: mark.status || null,
      closedAt: mark.closedAt || null,
      positionId: mark.positionId || null,
      walletAddress: mark.walletAddress || null,
    },
    provenance: "protocol-position-marks.jsonl",
    observedAt: mark.observedAt || null,
  };
}

function buildCostFloor(pendleResult, trueExitFromPosition) {
  if (trueExitFromPosition && trueExitFromPosition.evidenced) {
    const exitCost = finiteNumber(trueExitFromPosition.exitCostUsd, 0);
    const gasCost = finiteNumber(trueExitFromPosition.gasCostUsd, 0);
    return {
      status: "evidenced",
      value: {
        exitCostUsd: exitCost,
        gasCostUsd: gasCost,
        costFloorUsd: exitCost + gasCost,
        chainCostProfile: trueExitFromPosition.chainCostProfile || null,
      },
      provenance: "pendle-yt-exit-from-position-latest.json",
      observedAt: trueExitFromPosition.observedAt || trueExitFromPosition.generatedAt || null,
    };
  }
  if (pendleResult && pendleResult.ev) {
    const exitCost = finiteNumber(pendleResult.ev.exitCostUsd, 0);
    const gasCost = finiteNumber(pendleResult.ev.gasCostUsd, 0);
    return {
      status: "evidenced",
      value: {
        exitCostUsd: exitCost,
        gasCostUsd: gasCost,
        costFloorUsd: exitCost + gasCost,
        chainCostProfile: pendleResult.ev.chainCostProfile || null,
      },
      provenance: "pendle-yt-dry-run-latest.json",
      observedAt: pendleResult.generatedAt || null,
    };
  }
  return {
    status: "missing",
    value: { provenanceKind: "missing_cost_floor_producer", producerName: "exit_cost_floor_producer" },
    provenance: "exit_cost_floor_producer",
    observedAt: null,
  };
}

export function buildLifecycleEvidence({
  candidate,
  protocolPositionMarks = [],
  pendleYtDryRun = null,
  pendleYtExitFromPosition = null,
  merklUserRewards = null,
  walletAddress = null,
  now = null,
} = {}) {
  const envelope = emptyEvidence();
  if (!candidate || typeof candidate !== "object") {
    return { evidence: envelope, mark: null, missing: [...LIFECYCLE_KEYS] };
  }
  const mark = latestProtocolPositionMark(protocolPositionMarks, {
    opportunityId: candidate.opportunityId,
    chain: candidate.chain,
    walletAddress,
  });
  const pendleResult = pendleDryRunResultFor(pendleYtDryRun, candidate.opportunityId);
  const trueExitFromPosition = pendleYtExitFromPositionFor(pendleYtExitFromPosition, candidate.opportunityId);

  envelope.position_health = buildPositionHealth(mark, now);
  envelope.position_maturity_or_redeemability = buildMaturity(pendleResult, mark, now);
  envelope.exit_or_redeem_ev = buildExitRedeemEv(pendleResult, mark, trueExitFromPosition);
  envelope.claimable_or_harvest_amount = buildClaimable(merklUserRewards, mark);
  envelope.receipt_or_closed_at_state = buildReceiptClosedAt(mark);
  envelope.cost_floor = buildCostFloor(pendleResult, trueExitFromPosition);

  const missing = LIFECYCLE_KEYS.filter((key) => envelope[key].status === "missing");
  return { evidence: envelope, mark, pendleResult, trueExitFromPosition, missing };
}

export const LIFECYCLE_EVIDENCE_KEYS = LIFECYCLE_KEYS;
