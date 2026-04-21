import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DIVERSIFICATION_POLICY,
  GATEWAY_OFFICIAL_CHAINS,
  computeHhi,
  evaluateDiversification,
  canAcceptNewAllocation,
} from "../src/config/diversification.mjs";

test("DIVERSIFICATION_POLICY is frozen", () => {
  assert.throws(() => {
    DIVERSIFICATION_POLICY.perStrategyMaxShare = 1;
  });
});

test("Gateway official chains = 11 (no Arbitrum/Polygon)", () => {
  assert.equal(GATEWAY_OFFICIAL_CHAINS.length, 11);
  assert.ok(!GATEWAY_OFFICIAL_CHAINS.includes("arbitrum"));
  assert.ok(!GATEWAY_OFFICIAL_CHAINS.includes("polygon"));
});

test("computeHhi: empty or zero returns 0", () => {
  assert.equal(computeHhi({}), 0);
  assert.equal(computeHhi({ a: 0, b: 0 }), 0);
});

test("computeHhi(normalized): equal-weight N strategies => 1/N", () => {
  const h = computeHhi({ a: 1, b: 1, c: 1, d: 1 }, { mode: "normalized" });
  assert.ok(Math.abs(h - 0.25) < 1e-9);
});

test("computeHhi(portfolio): raw share squares; full allocation to one = 1", () => {
  assert.equal(computeHhi({ a: 1 }), 1);
  const h = computeHhi({ a: 0.25, b: 0.25, c: 0.25, d: 0.25 });
  assert.ok(Math.abs(h - 0.25) < 1e-9);
});

test("evaluateDiversification: ok when within all caps and HHI", () => {
  const v = evaluateDiversification({
    perStrategy: { s1: 0.2, s2: 0.2, s3: 0.2, s4: 0.2, s5: 0.2 },
    perChain: { base: 0.3, bob: 0.1, avalanche: 0.2 },
    perProtocol: { moonwell: 0.25, pendle: 0.25 },
    bobL2DirectShare: 0.05,
  });
  assert.equal(v.ok, true);
  assert.equal(v.violations.length, 0);
});

test("evaluateDiversification: flags per-strategy share > 25%", () => {
  const v = evaluateDiversification({
    perStrategy: { s1: 0.3, s2: 0.2 },
  });
  assert.ok(v.violations.some((x) => x.kind === "per_strategy_share_exceeded"));
});

test("evaluateDiversification: flags per-chain share > 35%", () => {
  const v = evaluateDiversification({
    perStrategy: { s1: 0.2 },
    perChain: { base: 0.4 },
  });
  assert.ok(v.violations.some((x) => x.kind === "per_chain_share_exceeded"));
});

test("evaluateDiversification: flags non-Gateway chain", () => {
  const v = evaluateDiversification({
    perStrategy: { s1: 0.2 },
    perChain: { arbitrum: 0.1 },
  });
  assert.ok(v.violations.some((x) => x.kind === "chain_not_gateway_official"));
});

test("evaluateDiversification: flags HHI > 0.30 (single strategy taking >54% of portfolio)", () => {
  const v = evaluateDiversification({
    perStrategy: { s1: 0.6, s2: 0.4 },
  });
  // Note: this allocation already violates per-strategy cap; HHI also flags.
  assert.ok(v.violations.some((x) => x.kind === "hhi_exceeded"));
});

test("evaluateDiversification: single strategy does not trigger HHI (needs diversification to measure)", () => {
  const v = evaluateDiversification({
    perStrategy: { s1: 0.2 },
  });
  assert.ok(!v.violations.some((x) => x.kind === "hhi_exceeded"));
});

test("evaluateDiversification: flags BOB L2 direct > 10%", () => {
  const v = evaluateDiversification({
    perStrategy: { s1: 0.2 },
    bobL2DirectShare: 0.15,
  });
  assert.ok(v.violations.some((x) => x.kind === "bob_l2_direct_share_exceeded"));
});

test("canAcceptNewAllocation: accepts within caps", () => {
  const current = {
    perStrategy: { s1: 0.1 },
    perChain: { base: 0.1 },
    perProtocol: { moonwell: 0.1 },
  };
  const res = canAcceptNewAllocation(current, {
    strategyId: "s2",
    chainId: "base",
    protocolIds: ["pendle"],
    addShare: 0.1,
  });
  assert.equal(res.accepted, true);
});

test("canAcceptNewAllocation: rejects when pushing strategy over cap", () => {
  const current = { perStrategy: { s1: 0.2 } };
  const res = canAcceptNewAllocation(current, {
    strategyId: "s1",
    chainId: "base",
    addShare: 0.1,
  });
  assert.equal(res.accepted, false);
  assert.ok(
    res.verdict.violations.some((x) => x.kind === "per_strategy_share_exceeded"),
  );
});

test("canAcceptNewAllocation: tracks BOB L2 direct holding", () => {
  const res = canAcceptNewAllocation(
    {},
    {
      strategyId: "s1",
      chainId: "bob",
      directHolding: true,
      addShare: 0.15,
    },
  );
  assert.equal(res.accepted, false);
  assert.ok(
    res.verdict.violations.some((x) => x.kind === "bob_l2_direct_share_exceeded"),
  );
});

test("canAcceptNewAllocation: rejects negative or non-finite addShare", () => {
  assert.throws(() => canAcceptNewAllocation({}, { strategyId: "s", addShare: -1 }));
  assert.throws(() => canAcceptNewAllocation({}, { strategyId: "s", addShare: NaN }));
});
