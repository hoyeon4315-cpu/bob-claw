import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateChainQualification,
  scanChains,
} from "../src/strategy/chain-discovery-scanner.mjs";
import {
  evaluateProtocolQualification,
  scanProtocols,
} from "../src/strategy/protocol-discovery-scanner.mjs";

function makeOpp(overrides = {}) {
  return {
    status: "LIVE",
    tvlUsd: 500_000,
    hasAudit: true,
    contractAgeDays: 400,
    top10HolderPct: 30,
    vol30dPct: 20,
    ...overrides,
  };
}

test("evaluateChainQualification qualifies at threshold", () => {
  const opps = Array.from({ length: 5 }).map(() => makeOpp());
  const result = evaluateChainQualification(opps);
  assert.equal(result.qualified, true);
  assert.equal(result.liveCount, 5);
  assert.equal(result.totalTvl, 2_500_000);
  assert.equal(result.tierAB, 5);
});

test("evaluateChainQualification fails below live count", () => {
  const opps = Array.from({ length: 4 }).map(() => makeOpp());
  const result = evaluateChainQualification(opps);
  assert.equal(result.qualified, false);
});

test("evaluateChainQualification fails below tvl threshold", () => {
  const opps = Array.from({ length: 5 }).map(() => makeOpp({ tvlUsd: 100_000 }));
  const result = evaluateChainQualification(opps);
  assert.equal(result.qualified, false);
});

test("evaluateChainQualification fails with no tier AB", () => {
  const opps = Array.from({ length: 5 }).map(() =>
    makeOpp({ hasAudit: false, tvlUsd: 100_000 })
  );
  const result = evaluateChainQualification(opps);
  assert.equal(result.qualified, false);
});

test("scanChains groups and filters", () => {
  const opps = [
    ...Array.from({ length: 5 }).map(() => makeOpp({ chain: "nova" })),
    ...Array.from({ length: 3 }).map(() => makeOpp({ chain: "old" })),
  ];
  const result = scanChains(opps);
  assert.equal(result.length, 1);
  assert.equal(result[0].chain, "nova");
});

test("evaluateProtocolQualification qualifies at threshold", () => {
  const opps = [
    makeOpp({ protocol: "protoA", opportunityId: "a1", tvlUsd: 400_000 }),
    makeOpp({ protocol: "protoA", opportunityId: "a2", tvlUsd: 400_000 }),
    makeOpp({ protocol: "protoA", opportunityId: "a3", tvlUsd: 400_000 }),
  ];
  const result = evaluateProtocolQualification(opps);
  assert.equal(result.qualified, true);
  assert.equal(result.totalTvl, 1_200_000);
  assert.equal(result.distinctOpps, 3);
});

test("evaluateProtocolQualification fails below tvl", () => {
  const opps = [
    makeOpp({ protocol: "protoA", opportunityId: "a1", tvlUsd: 100_000 }),
    makeOpp({ protocol: "protoA", opportunityId: "a2", tvlUsd: 100_000 }),
    makeOpp({ protocol: "protoA", opportunityId: "a3", tvlUsd: 100_000 }),
  ];
  const result = evaluateProtocolQualification(opps);
  assert.equal(result.qualified, false);
});

test("evaluateProtocolQualification fails without audit", () => {
  const opps = [
    makeOpp({ protocol: "protoA", opportunityId: "a1", tvlUsd: 500_000, hasAudit: false }),
    makeOpp({ protocol: "protoA", opportunityId: "a2", tvlUsd: 500_000, hasAudit: false }),
    makeOpp({ protocol: "protoA", opportunityId: "a3", tvlUsd: 500_000, hasAudit: false }),
  ];
  const result = evaluateProtocolQualification(opps);
  assert.equal(result.qualified, false);
});

test("evaluateProtocolQualification fails below distinct opp count", () => {
  const opps = [
    makeOpp({ protocol: "protoA", opportunityId: "a1", tvlUsd: 600_000 }),
    makeOpp({ protocol: "protoA", opportunityId: "a1", tvlUsd: 600_000 }),
  ];
  const result = evaluateProtocolQualification(opps);
  assert.equal(result.qualified, false);
});

test("scanProtocols groups and filters", () => {
  const opps = [
    makeOpp({ protocol: "good", opportunityId: "g1", tvlUsd: 400_000 }),
    makeOpp({ protocol: "good", opportunityId: "g2", tvlUsd: 400_000 }),
    makeOpp({ protocol: "good", opportunityId: "g3", tvlUsd: 400_000 }),
    makeOpp({ protocol: "bad", opportunityId: "b1", tvlUsd: 100_000 }),
  ];
  const result = scanProtocols(opps);
  assert.equal(result.length, 1);
  assert.equal(result[0].protocol, "good");
});
