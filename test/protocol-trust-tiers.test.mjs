import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProtocolTrustTiers, resolveTrustTierDecision, summarizeProtocolTrustTiers } from "../src/strategy/protocol-trust-tiers.mjs";

test("protocol trust tiers record known dependencies and expose decisions", () => {
  const report = buildProtocolTrustTiers({
    wrappedBtcLendingLoopSlice: {
      strategy: { id: "wrapped-btc-loop-base-moonwell", protocol: "moonwell" },
    },
    secondaryStrategyScaffolds: {
      scaffolds: [
        { id: "stablecoin_spread_loop", protocolTrack: { protocols: ["morpho", "aave_v3", "euler"] } },
        { id: "onchain_btc_perp_basis", protocolTrack: { venues: ["gmx", "vertex", "synthetix_v3"] } },
      ],
    },
    now: "2026-04-15T19:00:00.000Z",
  });

  assert.equal(report.summary.recordedCount, 7);
  assert.equal(report.summary.reviewRequiredCount, 0);
  assert.equal(summarizeProtocolTrustTiers(report).itemCount, 7);

  const decision = resolveTrustTierDecision(report, ["moonwell", "aave_v3"]);
  assert.equal(decision.recorded, true);
  assert.equal(decision.entries.length, 2);
});
