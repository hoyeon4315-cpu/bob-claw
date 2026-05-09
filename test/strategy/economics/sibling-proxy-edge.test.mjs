import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSiblingProxyEdgeRecords } from "../../../src/strategy/economics/sibling-proxy-edge.mjs";

const strategies = [
  { strategyId: "target", autoExecute: true, chain: "base", familyId: "btc_loop" },
  { strategyId: "sibling-low", autoExecute: true, chain: "optimism", familyId: "btc_loop" },
  { strategyId: "sibling-high", autoExecute: true, chain: "sonic", familyId: "btc_loop" },
  { strategyId: "other", autoExecute: true, chain: "base", familyId: "stable_loop" },
];

test("sibling proxy borrows the highest-sample receipt sibling in the same family", () => {
  const records = buildSiblingProxyEdgeRecords({
    strategies,
    targetStrategies: [strategies[0]],
    directEvidenceByStrategy: {
      "sibling-low": {
        strategyId: "sibling-low",
        chain: "optimism",
        familyId: "btc_loop",
        evidenceClass: "receipt",
        measuredEdgeBpsPerDay: 10,
        measuredRoundTripCostUsd: 0.2,
        freshness: { sampleCount: 2 },
      },
      "sibling-high": {
        strategyId: "sibling-high",
        chain: "sonic",
        familyId: "btc_loop",
        evidenceClass: "receipt",
        measuredEdgeBpsPerDay: 14,
        measuredRoundTripCostUsd: 0.3,
        freshness: { sampleCount: 5 },
      },
    },
  });

  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    strategyId: "target",
    chain: "base",
    evidenceClass: "sibling_proxy",
    borrowedFromStrategyId: "sibling-high",
    borrowedFromChain: "sonic",
    proxyEdgeBpsPerDay: 14,
    proxyRoundTripCostUsd: 0.3,
    confidence: 0.4,
    reason: "same_family_receipt_proxy",
  });
});

test("sibling proxy does not fire when direct receipt or shadow evidence exists", () => {
  const records = buildSiblingProxyEdgeRecords({
    strategies,
    targetStrategies: [strategies[0]],
    directEvidenceByStrategy: {
      target: { strategyId: "target", chain: "base", evidenceClass: "shadow" },
      "sibling-high": {
        strategyId: "sibling-high",
        chain: "sonic",
        familyId: "btc_loop",
        evidenceClass: "receipt",
        measuredEdgeBpsPerDay: 14,
        measuredRoundTripCostUsd: 0.3,
        freshness: { sampleCount: 5 },
      },
    },
  });
  assert.deepEqual(records, []);
});

test("sibling proxy returns no records when no same-family sibling has receipt evidence", () => {
  const records = buildSiblingProxyEdgeRecords({
    strategies,
    targetStrategies: [strategies[0]],
    directEvidenceByStrategy: {
      other: {
        strategyId: "other",
        chain: "base",
        familyId: "stable_loop",
        evidenceClass: "receipt",
        measuredEdgeBpsPerDay: 20,
        measuredRoundTripCostUsd: 0.1,
        freshness: { sampleCount: 9 },
      },
    },
  });
  assert.deepEqual(records, []);
});
