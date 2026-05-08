import test from "node:test";
import assert from "node:assert/strict";
import { canonicalGatewayChain } from "../src/config/gateway-destinations.mjs";
import { buildChainScoreLedger } from "../src/strategy/chain-score-ledger.mjs";

test("canonicalGatewayChain normalizes Gateway destination aliases", () => {
  assert.equal(canonicalGatewayChain("BNB Chain"), "bsc");
  assert.equal(canonicalGatewayChain("bnb"), "bsc");
  assert.equal(canonicalGatewayChain("berachain"), "bera");
  assert.equal(canonicalGatewayChain("avax"), "avalanche");
});

test("chain score ledger prefers fresh positive finality-safe receipts over stale losing receipts", () => {
  const now = "2026-05-08T00:00:00.000Z";
  const report = buildChainScoreLedger({
    now,
    records: [
      {
        source: "signer",
        strategyId: "base-lane",
        chain: "base",
        observedAt: "2026-04-20T00:00:00.000Z",
        broadcast: { txHash: "0xbase" },
        lifecycle: { stage: "confirmed", confirmations: 64 },
        reconciliationStatus: "reconciled",
        evidenceClass: "strategy_realized_pnl",
        realized: { realizedNetPnlSats: -500 },
      },
      {
        source: "signer",
        strategyId: "bsc-lane",
        chain: "BNB Chain",
        observedAt: "2026-05-07T22:00:00.000Z",
        broadcast: { txHash: "0xbsc" },
        lifecycle: { stage: "confirmed", confirmations: 64 },
        reconciliationStatus: "reconciled",
        evidenceClass: "strategy_realized_pnl",
        realized: { realizedNetPnlSats: 800 },
      },
      {
        source: "signer",
        strategyId: "bsc-cost",
        chain: "bsc",
        observedAt: "2026-05-07T23:00:00.000Z",
        broadcast: { txHash: "0cost" },
        lifecycle: { stage: "confirmed", confirmations: 64 },
        reconciliationStatus: "reconciled",
        evidenceClass: "execution_evidence_cost",
        realized: { realizedNetPnlSats: 10_000 },
        cost: { roundTripUsd: 0.05 },
      },
      {
        source: "signer",
        strategyId: "ignored-preview",
        chain: "bsc",
        observedAt: "2026-05-07T23:00:00.000Z",
        broadcast: { txHash: "0preview" },
        lifecycle: { stage: "confirmed", confirmations: 64 },
        reconciliationStatus: "reconciled",
        mode: "preview",
        evidenceClass: "strategy_realized_pnl",
        realized: { realizedNetPnlSats: 99_999 },
      },
    ],
    p90RoundTripUsdByChain: { base: 2.5, bsc: 0.08 },
    routeAvailabilityByChain: {
      base: { ok: true, exitLiquidityProof: true, rewardTokenConversionProof: true },
      bsc: { ok: true, exitLiquidityProof: true, rewardTokenConversionProof: true },
    },
    auditIntegrityStatus: "ok",
  });

  const base = report.byChain.base;
  const bsc = report.byChain.bsc;
  assert.ok(bsc.chainScore > base.chainScore, `${bsc.chainScore} should beat ${base.chainScore}`);
  assert.equal(bsc.scoreSource, "ledger");
  assert.equal(bsc.evidenceClassBreakdown.strategyRealizedPnlCount, 1);
  assert.equal(bsc.evidenceClassBreakdown.executionEvidenceCostCount, 1);
  assert.equal(bsc.realizedNetPnlSats7d, 800, "cost evidence must not be alpha PnL");
  assert.equal(report.byChain.bera.scoreSource, "prior");
  assert.deepEqual(report.byChain.bera.blockers, ["chain_score_unobserved"]);
});

test("chain score ledger keeps cost-only evidence wide-posterior and infers signer audit records", () => {
  const report = buildChainScoreLedger({
    now: "2026-05-08T00:00:00.000Z",
    records: Array.from({ length: 35 }, (_, index) => ({
      schemaVersion: 1,
      intentHash: `0xintent${index}`,
      policyVerdict: "broadcasted",
      strategyId: `cost-${index}`,
      chain: "BNB Chain",
      timestamp: "2026-05-07T00:00:00.000Z",
      broadcast: { txHash: `0xcost${index}` },
      lifecycle: { stage: "confirmed", confirmations: 16 },
      reconciliationStatus: "reconciled",
      evidenceClass: "execution_evidence_cost",
      cost: { roundTripUsd: 0.02 },
      realized: { realizedNetPnlSats: 50_000 },
    })),
    auditIntegrityStatus: "ok",
  });

  const bsc = report.byChain.bsc;
  assert.equal(bsc.sampleCount, 35);
  assert.equal(bsc.alphaSampleCount, 0);
  assert.equal(bsc.widePosterior, true);
  assert.deepEqual(bsc.blockers, ["strategy_realized_pnl_missing", "route_availability_unobserved"]);
  assert.equal(bsc.realizedNetPnlSats7d, 0);
});

test("chain score ledger keeps missing exit-liquidity proof as wide posterior", () => {
  const report = buildChainScoreLedger({
    now: "2026-05-08T00:00:00.000Z",
    records: Array.from({ length: 20 }, (_, index) => ({
      source: "signer",
      strategyId: `alpha-${index}`,
      chain: "bsc",
      observedAt: "2026-05-07T23:00:00.000Z",
      broadcast: { txHash: `0xproof${index}` },
      lifecycle: { stage: "confirmed", confirmations: 16 },
      reconciliationStatus: "reconciled",
      evidenceClass: "strategy_realized_pnl",
      realized: { realizedNetPnlSats: 500 },
    })),
    routeAvailabilityByChain: {
      bsc: { ok: true, rewardToken: null },
    },
    auditIntegrityStatus: "ok",
  });

  assert.equal(report.byChain.bsc.widePosterior, true);
  assert.ok(report.byChain.bsc.blockers.includes("exit_liquidity_proof_missing"));
});

test("chain score ledger does not score unreconciled tx hashes", () => {
  const report = buildChainScoreLedger({
    now: "2026-05-08T00:00:00.000Z",
    records: [
      {
        schemaVersion: 1,
        intentHash: "0xintent1",
        policyVerdict: "broadcasted",
        strategyId: "unreconciled-alpha",
        chain: "base",
        timestamp: "2026-05-07T23:00:00.000Z",
        broadcast: { txHash: "0xaaa" },
        lifecycle: { stage: "confirmed", confirmations: 64 },
        evidenceClass: "strategy_realized_pnl",
        realized: { realizedNetPnlSats: 5000 },
      },
    ],
    routeAvailabilityByChain: {
      base: { ok: true, exitLiquidityProof: true, rewardTokenConversionProof: true },
    },
    auditIntegrityStatus: "ok",
  });

  assert.equal(report.byChain.base.scoreSource, "prior");
  assert.equal(report.byChain.base.sampleCount, 0);
  assert.deepEqual(report.byChain.base.blockers, ["chain_score_unobserved"]);
});

test("chain score ledger clamps day-over-day score jumps", () => {
  const report = buildChainScoreLedger({
    now: "2026-05-08T00:00:00.000Z",
    previousLedger: {
      byChain: {
        bsc: {
          chainScore: 0.2,
          observedAt: "2026-05-07T00:00:00.000Z",
        },
      },
    },
    records: Array.from({ length: 20 }, (_, index) => ({
      source: "signer",
      strategyId: `alpha-${index}`,
      chain: "bsc",
      observedAt: "2026-05-07T23:00:00.000Z",
      broadcast: { txHash: `0xalpha${index}` },
      lifecycle: { stage: "confirmed", confirmations: 16 },
      reconciliationStatus: "reconciled",
      evidenceClass: "strategy_realized_pnl",
      realized: { realizedNetPnlSats: 10_000 },
    })),
    policy: {
      halfLifeHours: 168,
      priorScore: 0.5,
      minObservedSamplesForConfidentScore: 10,
      maxScoreDeltaPerDay: 0.25,
      weights: {
        realizedNetBtc: 0.45,
        receiptFreshness: 0.25,
        routeAvailability: 0.15,
        costEfficiency: 0.15,
      },
    },
    routeAvailabilityByChain: {
      bsc: { ok: true, exitLiquidityProof: true, rewardTokenConversionProof: true },
    },
    auditIntegrityStatus: "ok",
  });

  assert.equal(report.byChain.bsc.chainScore, 0.45);
  assert.ok(report.byChain.bsc.blockers.includes("score_delta_clamped"));
});
