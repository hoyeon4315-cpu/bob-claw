import test from "node:test";
import assert from "node:assert/strict";
import { buildChainHypothesisReport } from "../src/strategy/chain-hypothesis-evaluator.mjs";
import { buildScoredTargetBalances } from "../src/executor/capital/scored-target-balances.mjs";

test("chain hypothesis separates strategy-primary expiry from payback reserve proof", () => {
  const report = buildChainHypothesisReport({
    now: "2026-05-18T00:00:00.000Z",
    config: {
      strategyPrimaryHypotheses: [
        {
          chain: "base",
          role: "strategy_primary_reference",
          assertedAt: "2026-04-27T00:00:00.000Z",
          expiresAt: "2026-05-16T00:00:00.000Z",
          evidenceSource: "receipt-backed Base profile",
        },
      ],
      paybackReserveProofs: [
        {
          chain: "base",
          status: "proven",
          proofPath: "profit reserve -> BOB L2 -> Bitcoin L1",
          assertedAt: "2026-04-27T00:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(report.strategyPrimaryHypotheses[0].status, "expired");
  assert.equal(report.strategyPrimaryHypotheses[0].autoRenewCandidate, true);
  assert.equal(report.strategyPrimaryHypotheses[0].committedDiffRequired, true);
  assert.equal(report.paybackReserveProofs[0].chain, "base");
  assert.equal(report.paybackReserveProofs[0].status, "proven");
  assert.equal(report.summary.expiredStrategyPrimaryCount, 1);
  assert.equal(report.summary.reserveProofGapCount, 0);
});

test("expired strategy-primary hypothesis removes allocation share override only", () => {
  const caps = [
    { strategyId: "base-primary", familyId: "base-family", autoExecute: true, caps: { perChainUsd: { base: 1000 } } },
    { strategyId: "bsc-secondary", familyId: "bsc-family", autoExecute: true, caps: { perChainUsd: { bsc: 1000 } } },
  ];
  const promotionGate = {
    items: [
      { templateId: "base:base-family", chain: "base", familyId: "base-family", score: 0.9, allocationGate: { status: "allocation_ready" } },
      { templateId: "bsc:bsc-family", chain: "bsc", familyId: "bsc-family", score: 0.1, allocationGate: { status: "allocation_ready" } },
    ],
  };
  const chainHypothesis = buildChainHypothesisReport({
    now: "2026-05-18T00:00:00.000Z",
    config: {
      strategyPrimaryHypotheses: [
        {
          chain: "base",
          role: "strategy_primary_reference",
          assertedAt: "2026-04-27T00:00:00.000Z",
          expiresAt: "2026-05-16T00:00:00.000Z",
        },
      ],
      paybackReserveProofs: [
        {
          chain: "base",
          status: "proven",
          proofPath: "profit reserve -> BOB L2 -> Bitcoin L1",
          assertedAt: "2026-04-27T00:00:00.000Z",
        },
      ],
    },
  });

  const result = buildScoredTargetBalances({
    promotionGate,
    strategyCaps: caps,
    totalCapitalUsd: 1000,
    chainHypothesis,
    diversificationPolicy: {
      perStrategyMaxShare: 1,
      perChainMaxShare: 0.35,
      perChainMaxShareByChain: { base: 0.70 },
    },
  });

  const base = result.perChain.find((item) => item.chain === "base");
  const baseStrategy = result.perStrategy.find((item) => item.chain === "base");
  assert.equal(base.settlementTargetUsd, 350);
  assert.equal(baseStrategy.strategyPrimaryHypothesisStatus, "expired");
  assert.ok(baseStrategy.chainScoreBlockers.includes("strategy_primary_hypothesis_expired"));
  assert.equal(chainHypothesis.paybackReserveProofs[0].status, "proven");
});
