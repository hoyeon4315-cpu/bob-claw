import { test } from "node:test";
import assert from "node:assert";
import { evaluateOpportunityPolicy } from "../src/executor/policy/opportunity-policy.mjs";

test("capital movement intent exempt from cross_chain_unprofitable gate", async () => {
  const intent = {
    strategyId: "lifi-bridge",
    intentType: "bridge",
    amountUsd: 150,
    chain: "base",
    srcChain: "ethereum",
    dstChain: "base",
    estimatedBridgeCostUsd: 5,
    expectedHoldDays: 1,
    apr: 0,
    quote: { observedAt: new Date().toISOString() },
  };
  const result = await evaluateOpportunityPolicy({
    intent,
    currentAllocations: { chainSharePct: {}, protocolSharePct: {}, opportunitySharePct: {} },
    capitalState: { totalDeployableCapital: 520 },
  });
  assert.strictEqual(result.decision, "ALLOW", "bridge intent should not be blocked by profitability gate");
  assert.ok(!result.blockers.some((b) => b.includes("unprofitable")), "no unprofitable blocker for movement");
});

test("capital movement intent exempt from same_chain_unprofitable gate", async () => {
  const intent = {
    strategyId: "test",
    intentType: "withdraw",
    action: "withdraw",
    amountUsd: 75,
    chain: "ethereum",
    estimatedGasCostUsd: 0.73,
    expectedHoldDays: 1,
    apr: 0,
    quote: { observedAt: new Date().toISOString() },
  };
  const result = await evaluateOpportunityPolicy({
    intent,
    currentAllocations: { chainSharePct: {}, protocolSharePct: {}, opportunitySharePct: {} },
    capitalState: { totalDeployableCapital: 520 },
  });
  assert.strictEqual(result.decision, "ALLOW", "withdraw intent should not be blocked by gas profitability");
  assert.ok(!result.blockers.some((b) => b.includes("unprofitable")), "no unprofitable blocker for movement");
});

test("capital movement intent allows up to 70% of capital", async () => {
  const intent = {
    strategyId: "test",
    intentType: "bridge",
    amountUsd: 350,
    chain: "base",
    srcChain: "ethereum",
    dstChain: "base",
    quote: { observedAt: new Date().toISOString() },
  };
  const result = await evaluateOpportunityPolicy({
    intent,
    currentAllocations: { chainSharePct: {}, protocolSharePct: {}, opportunitySharePct: {} },
    capitalState: { totalDeployableCapital: 520 },
  });
  assert.strictEqual(result.decision, "ALLOW", "bridge $350 should be allowed as movement (70% of 520 = 364)");
  assert.ok(!result.blockers.includes("position_above_max_single_position_pct"), "no position size blocker for movement");
});

test("capital movement intent still blocked above 70%", async () => {
  const intent = {
    strategyId: "test",
    intentType: "bridge",
    amountUsd: 400,
    chain: "base",
    srcChain: "ethereum",
    dstChain: "base",
    quote: { observedAt: new Date().toISOString() },
  };
  const result = await evaluateOpportunityPolicy({
    intent,
    currentAllocations: { chainSharePct: {}, protocolSharePct: {}, opportunitySharePct: {} },
    capitalState: { totalDeployableCapital: 520 },
  });
  assert.strictEqual(result.decision, "BLOCK", "bridge $400 should be blocked (exceeds 70% of 520 = 364)");
  assert.ok(result.blockers.includes("position_above_max_single_position_pct"), "position size blocker above 70%");
});

test("non-movement intent still blocked by cross_chain_unprofitable", async () => {
  const intent = {
    strategyId: "aerodrome-cl-weth-cbbtc",
    intentType: "concentrated_liquidity",
    amountUsd: 20,
    chain: "base",
    srcChain: "ethereum",
    dstChain: "base",
    estimatedBridgeCostUsd: 5,
    expectedHoldDays: 14,
    apr: 10,
    quote: { observedAt: new Date().toISOString() },
  };
  const result = await evaluateOpportunityPolicy({
    intent,
    currentAllocations: { chainSharePct: {}, protocolSharePct: {}, opportunitySharePct: {} },
    capitalState: { totalDeployableCapital: 520 },
  });
  assert.strictEqual(result.decision, "BLOCK", "non-movement small position should be blocked");
  assert.ok(result.blockers.some((b) => b.includes("unprofitable")), "unprofitable blocker for non-movement");
});

test("capital movement intent still respects chain concentration", async () => {
  const intent = {
    strategyId: "lifi-bridge",
    intentType: "bridge",
    amountUsd: 100,
    chain: "base",
    srcChain: "ethereum",
    dstChain: "base",
    quote: { observedAt: new Date().toISOString() },
  };
  const result = await evaluateOpportunityPolicy({
    intent,
    currentAllocations: { chainSharePct: { base: 0.55 }, protocolSharePct: {}, opportunitySharePct: {} },
    capitalState: { totalDeployableCapital: 520 },
  });
  assert.strictEqual(result.decision, "BLOCK", "movement should still respect chain concentration");
  assert.ok(result.blockers.includes("chain_concentration_exceeded"), "chain concentration blocker");
});

test("movement intent exempt from opportunity/protocol concentration", async () => {
  const intent = {
    strategyId: "test",
    intentType: "rebalance",
    action: "rebalance",
    amountUsd: 200,
    chain: "base",
    protocol: "aerodrome-slipstream",
    quote: { observedAt: new Date().toISOString() },
  };
  const result = await evaluateOpportunityPolicy({
    intent,
    currentAllocations: {
      chainSharePct: { base: 0.20 },
      protocolSharePct: { "aerodrome-slipstream": 0.40 },
      opportunitySharePct: { "aerodrome-cl": 0.40 },
    },
    capitalState: { totalDeployableCapital: 520 },
  });
  assert.strictEqual(result.decision, "ALLOW", "rebalance should not be blocked by opportunity/protocol concentration");
  assert.ok(!result.blockers.includes("opportunity_concentration_exceeded"), "no opportunity blocker for movement");
  assert.ok(!result.blockers.includes("protocol_concentration_exceeded"), "no protocol blocker for movement");
});

test("small capital relief: $32 capital allows $25 position (76.7%)", async () => {
  const intent = {
    strategyId: "aerodrome-cl-weth-cbbtc",
    intentType: "concentrated_liquidity",
    amountUsd: 25,
    chain: "base",
    protocol: "aerodrome-slipstream",
    quote: { observedAt: new Date().toISOString() },
  };
  const result = await evaluateOpportunityPolicy({
    intent,
    currentAllocations: { chainSharePct: {}, protocolSharePct: {}, opportunitySharePct: {} },
    capitalState: { totalDeployableCapital: 32 },
  });
  assert.strictEqual(result.decision, "ALLOW", "$25 position on $32 capital should be allowed via small-cap relief");
  assert.ok(!result.blockers.includes("position_above_max_single_position_pct"), "no position blocker with relief");
});

test("small capital relief: $32 capital blocks $30 position (93.7%)", async () => {
  const intent = {
    strategyId: "aerodrome-cl-weth-cbbtc",
    intentType: "concentrated_liquidity",
    amountUsd: 30,
    chain: "base",
    protocol: "aerodrome-slipstream",
    quote: { observedAt: new Date().toISOString() },
  };
  const result = await evaluateOpportunityPolicy({
    intent,
    currentAllocations: { chainSharePct: {}, protocolSharePct: {}, opportunitySharePct: {} },
    capitalState: { totalDeployableCapital: 32 },
  });
  assert.strictEqual(result.decision, "BLOCK", "$30 on $32 exceeds minPositionUsd/totalCapital ratio");
  assert.ok(result.blockers.includes("position_above_max_single_position_pct"), "position blocker above relief cap");
});

test("large capital uses 25% cap: $520 blocks $350 position (67%)", async () => {
  const intent = {
    strategyId: "aerodrome-cl-weth-cbbtc",
    intentType: "concentrated_liquidity",
    amountUsd: 350,
    chain: "base",
    protocol: "aerodrome-slipstream",
    quote: { observedAt: new Date().toISOString() },
  };
  const result = await evaluateOpportunityPolicy({
    intent,
    currentAllocations: { chainSharePct: {}, protocolSharePct: {}, opportunitySharePct: {} },
    capitalState: { totalDeployableCapital: 520 },
  });
  assert.strictEqual(result.decision, "BLOCK", "$350 on $520 exceeds 25% cap for large capital");
  assert.ok(result.blockers.includes("position_above_max_single_position_pct"), "25% cap enforced for large capital");
});

test("large capital 25% cap allows $130 on $520", async () => {
  const intent = {
    strategyId: "aerodrome-cl-weth-cbbtc",
    intentType: "concentrated_liquidity",
    amountUsd: 130,
    chain: "base",
    protocol: "aerodrome-slipstream",
    quote: { observedAt: new Date().toISOString() },
  };
  const result = await evaluateOpportunityPolicy({
    intent,
    currentAllocations: { chainSharePct: {}, protocolSharePct: {}, opportunitySharePct: {} },
    capitalState: { totalDeployableCapital: 520 },
  });
  assert.strictEqual(result.decision, "ALLOW", "$130 on $520 is within 25% cap");
  assert.ok(!result.blockers.includes("position_above_max_single_position_pct"), "25% cap allows $130");
});
