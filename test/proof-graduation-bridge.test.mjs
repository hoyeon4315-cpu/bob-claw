import test from "node:test";
import assert from "node:assert/strict";
import { buildProofGraduationCanaryRequest } from "../src/executor/canary/proof-graduation-bridge.mjs";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

function queueItem(overrides = {}) {
  const chain = overrides.chain || "base";
  const assetAddress = chain === "ethereum" ? USDC_ETH : USDC_BASE;
  return {
    opportunityId: "opp-proof",
    chain,
    protocolId: "yo",
    mappedStrategyId: "gateway_native_asset_conversion_sleeve",
    executionSurface: "stableCarry",
    priorityScore: 100,
    campaignRemainingHours: 720,
    aprPct: 100,
    rewardTokenType: "stable",
    executionReadiness: {
      status: "inventory_ready",
      matchedToken: {
        ticker: "USDC",
        token: assetAddress,
        actual: "100000000",
        estimatedUsd: 100,
      },
      matchedNative: {
        estimatedUsd: 2,
      },
    },
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: "erc4626_vault_supply_withdraw",
      resolvedBinding: {
        vaultAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
        assetAddress,
        shareTokenAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
        assetSymbol: "USDC",
        assetDecimals: 6,
      },
    },
    ...overrides,
  };
}

test("builds a first-rung graduation canary request for proof-missing Base candidate", () => {
  const result = buildProofGraduationCanaryRequest({
    queueItem: queueItem(),
    canaryExecutions: [],
    auditRecords: [],
    now: "2026-05-07T00:00:00.000Z",
  });

  assert.equal(result.status, "ready");
  assert.equal(result.request.opportunityId, "opp-proof");
  assert.equal(result.request.chain, "base");
  assert.equal(result.request.amountUsd, 5);
  assert.equal(result.request.executionReason, "merkl_canary_autopilot");
  assert.equal(result.request.metadata.portfolioHoldProofRequired, true);
  assert.equal(result.request.metadata.sameOpportunityHoldProofSatisfied, false);
});

test("honors the committed Ethereum minimum rung", () => {
  const result = buildProofGraduationCanaryRequest({
    queueItem: queueItem({ chain: "ethereum" }),
    canaryExecutions: [],
    auditRecords: [],
    now: "2026-05-07T00:00:00.000Z",
  });

  assert.equal(result.status, "ready");
  assert.equal(result.request.amountUsd, 25);
  assert.equal(result.request.graduation.rungIndex, 0);
});

test("preserves existing tiny-live-cap blocker when strategy lacks tiny cap", () => {
  const result = buildProofGraduationCanaryRequest({
    queueItem: queueItem({
      mappedStrategyId: "native-dex-experiment",
    }),
    canaryExecutions: [],
    auditRecords: [],
    now: "2026-05-07T00:00:00.000Z",
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("strategy_tiny_live_cap_missing"));
});

test("blocks graduation request when canary autopilot auto-entry is not ready", () => {
  const result = buildProofGraduationCanaryRequest({
    queueItem: queueItem({
      protocolBindingPlan: {
        status: "protocol_position_binding_required",
        bindingKind: "aave_v3_pool_supply_withdraw",
      },
      capabilityGaps: ["protocol_position_binding_required"],
    }),
    canaryExecutions: [],
    auditRecords: [],
    now: "2026-05-07T00:00:00.000Z",
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("protocol_binding_not_ready"));
  assert.ok(result.blockers.includes("protocol_position_binding_required"));
});

test("blocks graduation request when tiny-canary EV floor exceeds available inventory", () => {
  const result = buildProofGraduationCanaryRequest({
    queueItem: queueItem({
      chain: "sei",
      aprPct: 5.82,
      campaignRemainingHours: 185,
      executionReadiness: {
        status: "inventory_ready",
        matchedToken: {
          ticker: "USDC",
          token: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
          actual: "3307405",
          estimatedUsd: 3.307405,
        },
        matchedNative: {
          estimatedUsd: 1.9,
        },
      },
      protocolId: "yei",
      protocolBindingPlan: {
        status: "binding_ready",
        bindingKind: "aave_v3_pool_supply_withdraw",
        resolvedBinding: {
          poolAddress: "0x4a4d9abD36F923cBA0Af62A39C01dEC2944fb638",
          assetAddress: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
          aTokenAddress: "0x817B3C191092694C65f25B4d38D4935a8aB65616",
          assetSymbol: "USDC",
          assetDecimals: 6,
        },
      },
    }),
    canaryExecutions: [],
    auditRecords: [],
    now: "2026-05-07T00:00:00.000Z",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.request, null);
  assert.ok(result.blockers.some((blocker) => blocker.startsWith("same_chain_unprofitable:need_$")));
  assert.equal(result.evGate.limitingFactor, "inventory");
  assert.equal(result.evGate.currentAmountUsd, 3.307405);
  assert.ok(result.evGate.neededUsd > result.evGate.currentAmountUsd);
});
