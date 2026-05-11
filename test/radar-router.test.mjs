import assert from "node:assert/strict";
import test from "node:test";

import { resolveFamilyBinding } from "../src/strategy/radar/family-binding-registry.mjs";
import { buildRadarCanaryIntent } from "../src/strategy/radar/radar-candidate-router.mjs";

const calibratedPolicy = Object.freeze({
  calibrationStatus: "calibrated_aggressive_v1",
  thresholds: Object.freeze({
    clusterConfidenceMin: 0.6,
    portableWalletSetMin: 3,
    protocolAgeDaysMin: 30,
    protocolTvlUsdMin: 5_000_000,
    slippageBpsMax: 80,
    mevExposureScoreMax: 35,
  }),
});

const packet = Object.freeze({ packetId: "packet_1" });

function candidate(overrides = {}) {
  return {
    candidateId: "candidate_1",
    packetId: "packet_1",
    familyKey: "wrapped_btc_direct_lending",
    executionPath: "base_native_evm",
    chain: "base",
    protocol: "moonwell",
    opportunityId: "opp_1",
    displayedAprPct: 365,
    rewardTokenType: "stable",
    rewardToken: "USDC",
    proposedSizeBtc: "0.0001",
    committedCapBtc: "0.0002",
    protocolAuditStatus: "audited_by_known",
    sanctionsFlag: "clean",
    bridgeRouteSanctionsCheck: "clean",
    killSwitchState: "running",
    slippageSimAtSize: 20,
    mevExposureScore: 10,
    ...overrides,
  };
}

test("resolveFamilyBinding maps known families and blocks managed-only surfaces", () => {
  assert.deepEqual(resolveFamilyBinding({ familyKey: "wrapped_btc_direct_lending", chain: "base" }), {
    strategyId: "wrapped-btc-loop-base-moonwell",
    executionSubType: "erc4626_deposit",
    defaultHoldDays: 21,
    requiredFields: [],
  });
  assert.equal(resolveFamilyBinding({ familyKey: "wrapped_btc_direct_lending", chain: "bsc" }), null);
  assert.equal(resolveFamilyBinding({ familyKey: "cl_managed_required" }), null);
  assert.equal(resolveFamilyBinding({ familyKey: "point_or_pre_tge" }), null);
});

test("buildRadarCanaryIntent emits tiny live canary intent clamped to tiny cap", () => {
  const now = "2026-05-02T00:00:00.000Z";
  const result = buildRadarCanaryIntent({
    packet,
    candidate: candidate(),
    policy: calibratedPolicy,
    now,
    strategyCapsById: {
      "wrapped-btc-loop-base-moonwell": {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
    costLedger: {
      p90GasCostUsdForChain: () => 0.12,
      p90BridgeCostUsdForRoute: () => 0,
      p90ClaimCostUsdForProtocol: () => 0.1,
      p90RewardSwapCostUsdForToken: () => 0.1,
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.intent.intentType, "tiny_live_canary");
  assert.equal(result.intent.executionSubType, "erc4626_deposit");
  assert.equal(result.intent.strategyId, "wrapped-btc-loop-base-moonwell");
  assert.equal(result.intent.amountUsd, 25);
  assert.equal(result.intent.expectedHoldDays, 7);
  assert.equal(result.intent.observedAt, now);
  assert.equal(result.intent.quote.observedAt, now);
  assert.equal(result.intent.expectedNetUsd > 0, true);
  assert.equal(result.intent.metadata.radarCandidateId, "candidate_1");
  assert.equal(result.intent.metadata.expectedNetUsd, result.intent.expectedNetUsd);
  assert.equal(result.intent.metadata.btcPaybackConversionRequired, true);
});

test("buildRadarCanaryIntent uses campaignRemainingHours before campaignEndsAt for hold days", () => {
  const now = "2026-05-02T00:00:00.000Z";
  const result = buildRadarCanaryIntent({
    packet,
    now: "2026-05-07T00:30:00.000Z",
    candidate: candidate({
      campaignRemainingHours: 48,
      campaignEndsAt: "2026-05-12T00:00:00.000Z",
    }),
    policy: calibratedPolicy,
    now,
    strategyCapsById: {
      "wrapped-btc-loop-base-moonwell": {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
    costLedger: {
      p90GasCostUsdForChain: () => 0.12,
      p90BridgeCostUsdForRoute: () => 0,
      p90ClaimCostUsdForProtocol: () => 0.1,
      p90RewardSwapCostUsdForToken: () => 0.1,
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.intent.expectedHoldDays, 2);
});

test("buildRadarCanaryIntent clamps Merkl-derived canaries to candidate inventory amount", () => {
  const result = buildRadarCanaryIntent({
    packet,
    now: "2026-05-07T00:30:00.000Z",
    candidate: candidate({
      familyKey: "same_chain_stable_carry",
      protocol: "yo",
      displayedAprPct: 19.8,
      rewardToken: null,
      amountUsd: 1.39271,
      expectedHoldDays: 33.075833333333335,
    }),
    policy: calibratedPolicy,
    strategyCapsById: {
      stablecoin_spread_loop: {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
    costLedger: {
      p90GasCostUsdForChain: () => 0,
      p90BridgeCostUsdForRoute: () => 0,
      p90ClaimCostUsdForProtocol: () => 0.2,
      p90RewardSwapCostUsdForToken: () => 0.3,
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.intent.amountUsd, 1.39271);
  assert.equal(result.ev.p90GasUsd, 0.012);
  assert.equal(result.ev.p90ClaimUsd, 0);
  assert.equal(result.ev.p90SwapUsd, 0);
});

test("buildRadarCanaryIntent blocks when tiny live cap is missing", () => {
  const result = buildRadarCanaryIntent({
    packet,
    candidate: candidate(),
    policy: calibratedPolicy,
    strategyCapsById: {
      "wrapped-btc-loop-base-moonwell": {
        caps: { perTxUsd: 500 },
      },
    },
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("tiny_live_cap_missing"));
});

test("buildRadarCanaryIntent blocks non-Base candidates for Base-specific family bindings", () => {
  const result = buildRadarCanaryIntent({
    packet,
    candidate: candidate({
      executionPath: "gateway_destination",
      chain: "bsc",
      protocol: "venus",
    }),
    policy: calibratedPolicy,
    strategyCapsById: {
      "wrapped-btc-loop-base-moonwell": {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["family_binding_missing"]);
  assert.equal(result.intent, undefined);
});

test("buildRadarCanaryIntent blocks when radar lane lock is active", () => {
  const result = buildRadarCanaryIntent({
    packet,
    candidate: candidate(),
    policy: calibratedPolicy,
    radarLockOn: true,
    strategyCapsById: {
      "wrapped-btc-loop-base-moonwell": {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["radar_lock_active"]);
});

test("buildRadarCanaryIntent respects candidate gateStatus blockers", () => {
  const result = buildRadarCanaryIntent({
    packet,
    candidate: candidate({
      gateStatus: "blocked",
      blockers: ["same_chain_unprofitable:need_$64_on_base"],
    }),
    policy: calibratedPolicy,
    strategyCapsById: {
      "wrapped-btc-loop-base-moonwell": {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
  });

  assert.equal(result.status, "filtered");
  assert.deepEqual(result.blockers, []);
  assert.ok(result.filters.includes("same_chain_unprofitable:need_$64_on_base"));
});

test("buildRadarCanaryIntent blocks stale executable candidates", () => {
  const result = buildRadarCanaryIntent({
    packet,
    now: "2026-05-07T00:00:00.000Z",
    candidate: candidate({
      observedAt: "2026-05-01T00:00:00.000Z",
      gateStatus: "executable",
    }),
    policy: calibratedPolicy,
    strategyCapsById: {
      "wrapped-btc-loop-base-moonwell": {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("executable_candidate_stale"));
});

test("buildRadarCanaryIntent requires current Gateway route proof for bridged candidates", () => {
  const result = buildRadarCanaryIntent({
    packet,
    now: "2026-05-07T00:30:00.000Z",
    candidate: candidate({
      familyKey: "same_chain_stable_carry",
      executionPath: "gateway_to_evm_bridged",
      chain: "sei",
      protocol: "yei",
      displayedAprPct: 365,
      rewardToken: null,
      amountUsd: 3,
      expectedHoldDays: 30,
      gateStatus: "executable",
      observedAt: "2026-05-07T00:00:00.000Z",
    }),
    policy: calibratedPolicy,
    strategyCapsById: {
      stablecoin_spread_loop: {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("gateway_route_proof_missing"));
});

test("buildRadarCanaryIntent propagates Gateway route proof into bridged intents", () => {
  const result = buildRadarCanaryIntent({
    packet,
    now: "2026-05-07T00:30:00.000Z",
    candidate: candidate({
      familyKey: "same_chain_stable_carry",
      executionPath: "gateway_to_evm_bridged",
      chain: "sei",
      protocol: "yei",
      displayedAprPct: 365,
      rewardToken: null,
      amountUsd: 3,
      expectedHoldDays: 30,
      gateStatus: "executable",
      observedAt: "2026-05-07T00:00:00.000Z",
      gatewayQuoteId: "quote_1",
      gatewayRoute: {
        srcChain: "bitcoin",
        dstChain: "sei",
        srcToken: "BTC",
        dstToken: "USDC",
      },
      gatewayQuoteObservedAt: "2026-05-07T00:00:00.000Z",
    }),
    policy: calibratedPolicy,
    strategyCapsById: {
      stablecoin_spread_loop: {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
    costLedger: {
      p90GasCostUsdForChain: () => 0.003,
      p90BridgeCostUsdForRoute: () => 0.01,
      p90ClaimCostUsdForProtocol: () => 0,
      p90RewardSwapCostUsdForToken: () => 0,
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.intent.gatewayQuoteId, "quote_1");
  assert.deepEqual(result.intent.metadata.gatewayRoute, {
    srcChain: "bitcoin",
    dstChain: "sei",
    srcToken: "BTC",
    dstToken: "USDC",
  });
});

test("buildRadarCanaryIntent blocks non-stable reward tokens without exit liquidity proof when policy is not aggressive", () => {
  const result = buildRadarCanaryIntent({
    packet,
    candidate: candidate({
      displayedAprPct: 20_000,
      rewardTokenType: "defaultRewardToken",
      rewardToken: "AERO",
    }),
    policy: { ...calibratedPolicy, calibrationStatus: "unresolved" },
    strategyCapsById: {
      "wrapped-btc-loop-base-moonwell": {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
    costLedger: {
      p90GasCostUsdForChain: () => 0.12,
      p90BridgeCostUsdForRoute: () => 0,
      p90ClaimCostUsdForProtocol: () => 0.1,
      p90RewardSwapCostUsdForToken: () => 0.1,
    },
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("radar_policy_not_calibrated_aggressive"));
});

test("buildRadarCanaryIntent allows self-proof canary for aggressive v1 at committed notional", () => {
  const result = buildRadarCanaryIntent({
    packet,
    candidate: candidate({
      displayedAprPct: 20_000,
      rewardTokenType: "defaultRewardToken",
      rewardToken: "AERO",
    }),
    policy: calibratedPolicy,
    strategyCapsById: {
      "wrapped-btc-loop-base-moonwell": {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
    costLedger: {
      p90GasCostUsdForChain: () => 0.12,
      p90BridgeCostUsdForRoute: () => 0,
      p90ClaimCostUsdForProtocol: () => 0.1,
      p90RewardSwapCostUsdForToken: () => 0.1,
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.intent.metadata.selfProofCanary, true);
  assert.equal(result.intent.amountUsd, 25);
});

test("buildRadarCanaryIntent does not flag self-proof when liquidity is already proven", () => {
  const result = buildRadarCanaryIntent({
    packet,
    candidate: candidate({
      displayedAprPct: 20_000,
      rewardTokenType: "defaultRewardToken",
      rewardToken: "AERO",
      rewardTokenDexDepthUsd: 100,
    }),
    policy: calibratedPolicy,
    strategyCapsById: {
      "wrapped-btc-loop-base-moonwell": {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
    costLedger: {
      p90GasCostUsdForChain: () => 0.12,
      p90BridgeCostUsdForRoute: () => 0,
      p90ClaimCostUsdForProtocol: () => 0.1,
      p90RewardSwapCostUsdForToken: () => 0.1,
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.intent.metadata.selfProofCanary, undefined);
});
