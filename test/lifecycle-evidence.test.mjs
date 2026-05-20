import { test } from "node:test";
import { strict as assert } from "node:assert";
import { buildLifecycleEvidence, LIFECYCLE_EVIDENCE_KEYS } from "../src/strategy/lifecycle-evidence.mjs";

const OPP = "pendle-direct:8453:0x6ae9";
const CHAIN = "base";

function pendleMark({
  status = "open",
  observedAt = "2026-05-19T03:00:00.000Z",
  closedAt = null,
  protocolId = "pendle",
  opportunityId = OPP,
  chain = CHAIN,
} = {}) {
  return {
    event: "position_marked",
    status,
    observedAt,
    closedAt,
    opportunityId,
    chain,
    protocolId,
    bindingKind: "pendle_market_swap",
    assetSymbol: "YT",
    assetAmount: 349.24,
    shareBalance: "349241714986569603215",
    healthFactor: null,
    walletAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    freshness: "fresh",
    confidence: "verified_current",
    positionId: "protocol:base:pendle:...",
  };
}

function pendleDryRun({
  opportunityId = OPP,
  maturity = "2026-06-18T00:00:00.000Z",
  expectedNetUsd = 0.078,
  exitCostUsd = 0.01,
  gasCostUsd = 0.05,
  status = "positive_ev",
} = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-05-19T03:00:00.000Z",
    results: [
      {
        opportunityId,
        chain: "base",
        maturity,
        ev: {
          status,
          expectedNetUsd,
          exitCostUsd,
          gasCostUsd,
          chainCostProfile: "base",
          maturityHours: 856,
          holdDays: 34,
          exitQuote: { outputUsd: 10, depthUsd: 10000, slippageBps: 5, source: "pendle_fair_value_model" },
        },
        decision: "candidate",
        blockers: [],
      },
    ],
  };
}

test("envelope has all 6 lifecycle keys regardless of inputs", () => {
  const { evidence } = buildLifecycleEvidence({ candidate: { opportunityId: OPP, chain: CHAIN } });
  for (const key of LIFECYCLE_EVIDENCE_KEYS) {
    assert.ok(evidence[key], `${key} missing`);
    assert.ok(["evidenced", "missing", "not_applicable", "proxy"].includes(evidence[key].status));
  }
});

test("missing inputs yields all six keys missing", () => {
  const { evidence, missing } = buildLifecycleEvidence({ candidate: { opportunityId: OPP, chain: CHAIN } });
  assert.equal(missing.length, 6);
  for (const key of LIFECYCLE_EVIDENCE_KEYS) {
    assert.equal(evidence[key].status, "missing");
  }
});

function trueExitFromPositionReport({
  opportunityId = OPP,
  expectedNetUsd = 1234.56,
  exitGrossUsd = 1234.62,
  ytAmount = 100,
  ytPriceInAsset = 0.02,
  assetPriceUsd = 50000,
  chainCostProfile = "base",
  exitCostUsd = 0.01,
  gasCostUsd = 0.05,
} = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-05-19T03:00:00.000Z",
    producerName: "pendle_yt_exit_from_position",
    results: [
      {
        opportunityId,
        chain: CHAIN,
        evidenced: true,
        producerName: "pendle_yt_exit_from_position",
        ytAmount,
        ytPriceInAsset,
        assetPriceUsd,
        impliedApyDecimal: 0.156,
        yearsToExpiry: 0.082,
        ytPriceSource: "pendle_fair_value_model",
        onChainConfirmed: false,
        exitAssetUnits: ytAmount * ytPriceInAsset,
        exitGrossUsd,
        exitCostUsd,
        gasCostUsd,
        costFloorUsd: exitCostUsd + gasCostUsd,
        expectedNetUsd,
        chainCostProfile,
        observedAt: "2026-05-19T03:00:00.000Z",
        generatedAt: "2026-05-19T03:00:00.000Z",
      },
    ],
  };
}

test("true exit-from-position producer evidenced -> exit_or_redeem_ev status=evidenced with provenanceKind=true_exit_ev", () => {
  const mark = pendleMark();
  const trueReport = trueExitFromPositionReport({
    expectedNetUsd: 9.94,
    exitGrossUsd: 10,
    ytAmount: 100,
    ytPriceInAsset: 0.002,
    assetPriceUsd: 50,
  });
  const drr = pendleDryRun();
  const { evidence } = buildLifecycleEvidence({
    candidate: { opportunityId: OPP, chain: CHAIN },
    protocolPositionMarks: [mark],
    pendleYtDryRun: drr,
    pendleYtExitFromPosition: trueReport,
    now: "2026-05-19T03:05:00.000Z",
  });
  assert.equal(evidence.exit_or_redeem_ev.status, "evidenced");
  assert.equal(evidence.exit_or_redeem_ev.value.provenanceKind, "true_exit_ev");
  assert.equal(evidence.exit_or_redeem_ev.value.producerName, "pendle_yt_exit_from_position");
  assert.equal(evidence.exit_or_redeem_ev.value.expectedNetUsd, 9.94);
  assert.equal(evidence.exit_or_redeem_ev.value.ytAmount, 100);
  assert.equal(evidence.exit_or_redeem_ev.value.ytPriceInAsset, 0.002);
  assert.equal(evidence.exit_or_redeem_ev.value.assetPriceUsd, 50);
  assert.equal(evidence.cost_floor.status, "evidenced");
  assert.ok(Math.abs(evidence.cost_floor.value.costFloorUsd - 0.06) < 1e-9);
  assert.equal(evidence.cost_floor.provenance, "pendle-yt-exit-from-position-latest.json");
});

test("true producer not_evidenced does not override proxy when dry-run still present", () => {
  const mark = pendleMark();
  const drr = pendleDryRun();
  const trueReport = {
    schemaVersion: 1,
    results: [
      {
        opportunityId: OPP,
        evidenced: false,
        missingFields: ["yt_price_in_asset"],
        producerName: "pendle_yt_exit_from_position",
      },
    ],
  };
  const { evidence } = buildLifecycleEvidence({
    candidate: { opportunityId: OPP, chain: CHAIN },
    protocolPositionMarks: [mark],
    pendleYtDryRun: drr,
    pendleYtExitFromPosition: trueReport,
  });
  assert.equal(evidence.exit_or_redeem_ev.status, "proxy");
  assert.equal(evidence.exit_or_redeem_ev.value.provenanceKind, "entry_canary_ev_proxy");
  assert.deepEqual(evidence.exit_or_redeem_ev.value.trueProducerMissingFields, ["yt_price_in_asset"]);
});

test("true producer invalid_input (dimensional rejection) surfaces invalidFields on proxy slot and exit_or_redeem_ev stays non-evidenced", () => {
  const mark = pendleMark();
  const drr = pendleDryRun();
  const trueReport = {
    schemaVersion: 1,
    results: [
      {
        opportunityId: OPP,
        evidenced: false,
        missingFields: [],
        invalidFields: [
          "mark_underlying_asset_price_usd_missing",
          "mark_asset_price_usd_misapplies_underlying_full_price",
          "exit_quote_unit_not_asset_per_yt",
        ],
        producerName: "pendle_yt_exit_from_position",
      },
    ],
  };
  const { evidence } = buildLifecycleEvidence({
    candidate: { opportunityId: OPP, chain: CHAIN },
    protocolPositionMarks: [mark],
    pendleYtDryRun: drr,
    pendleYtExitFromPosition: trueReport,
  });
  assert.equal(evidence.exit_or_redeem_ev.status, "proxy");
  assert.notEqual(evidence.exit_or_redeem_ev.value.provenanceKind, "true_exit_ev");
  assert.ok(
    Array.isArray(evidence.exit_or_redeem_ev.value.trueProducerInvalidFields) &&
      evidence.exit_or_redeem_ev.value.trueProducerInvalidFields.includes(
        "mark_asset_price_usd_misapplies_underlying_full_price",
      ),
  );
  // cost_floor MUST fall back to dry-run proxy provenance, NOT
  // pendle-yt-exit-from-position-latest.json, because the true producer
  // rejected the inputs.
  assert.equal(evidence.cost_floor.provenance, "pendle-yt-dry-run-latest.json");
});

test("true producer invalid_input with no dry-run proxy emits exit_or_redeem_ev missing carrying invalidFields", () => {
  const mark = pendleMark();
  const trueReport = {
    schemaVersion: 1,
    results: [
      {
        opportunityId: OPP,
        evidenced: false,
        invalidFields: ["mark_underlying_asset_price_usd_missing"],
        producerName: "pendle_yt_exit_from_position",
      },
    ],
  };
  const { evidence } = buildLifecycleEvidence({
    candidate: { opportunityId: OPP, chain: CHAIN },
    protocolPositionMarks: [mark],
    pendleYtDryRun: null,
    pendleYtExitFromPosition: trueReport,
  });
  assert.equal(evidence.exit_or_redeem_ev.status, "missing");
  assert.equal(evidence.exit_or_redeem_ev.value.producerName, "pendle_yt_exit_from_position");
  assert.deepEqual(evidence.exit_or_redeem_ev.value.invalidFields, ["mark_underlying_asset_price_usd_missing"]);
});

test("Pendle dry-run-only emits exit_or_redeem_ev as proxy with provenanceKind + true producer name", () => {
  const mark = pendleMark();
  const drr = pendleDryRun();
  const { evidence } = buildLifecycleEvidence({
    candidate: { opportunityId: OPP, chain: CHAIN },
    protocolPositionMarks: [mark],
    pendleYtDryRun: drr,
    now: "2026-05-19T03:05:00.000Z",
  });
  assert.equal(evidence.position_health.status, "evidenced");
  assert.equal(evidence.position_maturity_or_redeemability.status, "evidenced");
  assert.equal(evidence.position_maturity_or_redeemability.value.matured, false);
  assert.equal(evidence.exit_or_redeem_ev.status, "proxy");
  assert.equal(evidence.exit_or_redeem_ev.value.provenanceKind, "entry_canary_ev_proxy");
  assert.equal(evidence.exit_or_redeem_ev.value.proxyAcceptedByPolicy, false);
  assert.equal(evidence.exit_or_redeem_ev.value.trueExitProducerName, "pendle_yt_exit_from_position");
  assert.equal(evidence.exit_or_redeem_ev.value.expectedNetUsd, 0.078);
  assert.equal(evidence.cost_floor.status, "evidenced");
  assert.ok(Math.abs(evidence.cost_floor.value.costFloorUsd - 0.06) < 1e-9);
  assert.equal(evidence.receipt_or_closed_at_state.status, "evidenced");
  assert.equal(evidence.receipt_or_closed_at_state.value.status, "open");
  assert.equal(evidence.claimable_or_harvest_amount.status, "not_applicable");
});

test("Pendle open position with no dry-run emits exit_or_redeem_ev as missing with exact producer name", () => {
  const mark = pendleMark();
  const { evidence } = buildLifecycleEvidence({
    candidate: { opportunityId: OPP, chain: CHAIN },
    protocolPositionMarks: [mark],
    pendleYtDryRun: null,
  });
  assert.equal(evidence.exit_or_redeem_ev.status, "missing");
  assert.equal(evidence.exit_or_redeem_ev.value.provenanceKind, "missing_exit_ev_producer");
  assert.equal(evidence.exit_or_redeem_ev.value.producerName, "pendle_yt_exit_from_position");
  assert.equal(evidence.exit_or_redeem_ev.provenance, "pendle_yt_exit_from_position");
});

test("non-Pendle open position with no exit producer emits missing with non-Pendle producer name", () => {
  const mark = pendleMark({ protocolId: "aave_v3", opportunityId: "aave-base-usdc" });
  const { evidence } = buildLifecycleEvidence({
    candidate: { opportunityId: "aave-base-usdc", chain: CHAIN },
    protocolPositionMarks: [mark],
  });
  assert.equal(evidence.exit_or_redeem_ev.status, "missing");
  assert.equal(evidence.exit_or_redeem_ev.value.producerName, "exit_ev_producer_for_non_pendle_protocol");
});

test("matured Pendle position sets matured=true and redeemable=true", () => {
  const drr = pendleDryRun({ maturity: "2026-05-01T00:00:00.000Z" });
  const { evidence } = buildLifecycleEvidence({
    candidate: { opportunityId: OPP, chain: CHAIN },
    protocolPositionMarks: [pendleMark()],
    pendleYtDryRun: drr,
    now: "2026-05-19T03:00:00.000Z",
  });
  assert.equal(evidence.position_maturity_or_redeemability.value.matured, true);
  assert.equal(evidence.position_maturity_or_redeemability.value.redeemable, true);
});

test("non-Pendle mark with merkl rewards sets claimable evidenced", () => {
  const mark = pendleMark({ protocolId: "merkl", opportunityId: "merkl-pool-x" });
  const { evidence } = buildLifecycleEvidence({
    candidate: { opportunityId: "merkl-pool-x", chain: CHAIN },
    protocolPositionMarks: [mark],
    merklUserRewards: {
      schemaVersion: 1,
      observedAt: "2026-05-19T03:00:00.000Z",
      totalClaimableUsd: 0.33,
      totalPendingUsd: 0.0002,
      claimPlan: { status: "ready", readyChainCount: 1, blockedChainCount: 0, chains: [{}] },
    },
  });
  assert.equal(evidence.claimable_or_harvest_amount.status, "evidenced");
  assert.equal(evidence.claimable_or_harvest_amount.value.totalClaimableUsd, 0.33);
  assert.equal(evidence.position_maturity_or_redeemability.status, "not_applicable");
});

test("closed mark sets closedAt evidence + positionClosed signal via receipt slot", () => {
  const mark = pendleMark({ status: "closed", closedAt: "2026-05-18T00:00:00.000Z" });
  const { evidence } = buildLifecycleEvidence({
    candidate: { opportunityId: OPP, chain: CHAIN },
    protocolPositionMarks: [mark],
  });
  assert.equal(evidence.receipt_or_closed_at_state.status, "evidenced");
  assert.equal(evidence.receipt_or_closed_at_state.value.status, "closed");
  assert.equal(evidence.receipt_or_closed_at_state.value.closedAt, "2026-05-18T00:00:00.000Z");
});

test("stale mark flagged in freshness when age exceeds 6h", () => {
  const mark = pendleMark({ observedAt: "2026-05-19T00:00:00.000Z" });
  const { evidence } = buildLifecycleEvidence({
    candidate: { opportunityId: OPP, chain: CHAIN },
    protocolPositionMarks: [mark],
    now: "2026-05-19T10:00:00.000Z",
  });
  assert.equal(evidence.position_health.value.freshness, "stale");
});

test("opportunityId filter prevents cross-contamination", () => {
  const mark = pendleMark({ opportunityId: "other-op" });
  const { evidence, mark: matched } = buildLifecycleEvidence({
    candidate: { opportunityId: OPP, chain: CHAIN },
    protocolPositionMarks: [mark],
  });
  assert.equal(matched, null);
  assert.equal(evidence.position_health.status, "missing");
});
