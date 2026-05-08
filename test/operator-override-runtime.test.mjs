import assert from "node:assert/strict";
import test from "node:test";

import { RADAR_POLICY } from "../src/config/radar-policy.mjs";
import { evaluateIntentPolicies } from "../src/executor/policy/index.mjs";
import { buildTinyLiveCanaryIntent } from "../src/executor/policy/tiny-live-canary-intent.mjs";
import { buildMerklCanaryQueue } from "../src/strategy/merkl-canary-queue.mjs";
import { buildRadarCanaryIntent } from "../src/strategy/radar/radar-candidate-router.mjs";

const NOW = "2026-05-09T00:00:00.000Z";

function emergencyUnwindReceipt(strategyId) {
  return {
    strategyId,
    intent: { intentType: "emergency_unwind" },
    lifecycle: { stage: "confirmed" },
    observedAt: NOW,
  };
}

const costLedger = Object.freeze({
  p90GasCostUsdForChain: () => 0.012,
  p90BridgeCostUsdForRoute: () => 0,
  p90ClaimCostUsdForProtocol: () => 0.01,
  p90RewardSwapCostUsdForToken: () => 0.01,
});

const advisorySurfaceBlock = Object.freeze({
  surfaceLiveEligible: false,
  adviceCode: "phase3_evidence_missing",
  adviceFields: ["liveAdmissionBlockers"],
  adviceAuthority: "commit_time_guard",
});

test("calibrated aggressive radar executable emits intent and policy allows despite surface advice", async () => {
  assert.equal(RADAR_POLICY.calibrationStatus, "calibrated_aggressive_v1");

  const routed = buildRadarCanaryIntent({
    packet: { packetId: "radar_packet_override_fixture" },
    candidate: {
      candidateId: "radar_candidate_override_fixture",
      packetId: "radar_packet_override_fixture",
      familyKey: "wrapped_btc_direct_lending",
      executionPath: "base_native_evm",
      chain: "base",
      protocol: "moonwell",
      opportunityId: "moonwell_cbBTC_supply_override_fixture",
      gateStatus: "executable",
      observedAt: NOW,
      displayedAprPct: 1000,
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
      amountUsd: 25,
    },
    policy: RADAR_POLICY,
    now: NOW,
    strategyCapsById: {
      "wrapped-btc-loop-base-moonwell": {
        caps: { tinyLivePerTxUsd: 25 },
      },
    },
    costLedger,
  });

  assert.equal(routed.status, "ready");
  assert.equal(routed.intent.strategyId, "wrapped-btc-loop-base-moonwell");
  assert.equal(routed.intent.intentType, "tiny_live_canary");

  routed.intent.metadata.advisory = advisorySurfaceBlock;

  const policy = await evaluateIntentPolicies({
    intent: routed.intent,
    auditRecords: [emergencyUnwindReceipt("wrapped-btc-loop-base-moonwell")],
    riskContext: { microCanaryStatus: "minimal_live_proof_exists" },
    now: NOW,
    killSwitchPath: null,
  });

  assert.equal(policy.decision, "ALLOW");
  assert.equal(policy.blockers.includes("phase3_evidence_missing"), false);
  assert.equal(policy.effectiveIntent.metadata.advisory.surfaceLiveEligible, false);
});

test("Merkl live-capital validation queue can emit policy-approved tiny canary despite surface advice", async () => {
  const assetAddress = "0x00000000000000000000000000000000000000a1";
  const queue = buildMerklCanaryQueue({
    now: NOW,
    report: {
      generatedAt: NOW,
      policyProfile: "operator_override_merkl_fixture",
      opportunities: [
        {
          decision: "candidate",
          validationMode: "tiny_live_canary_only",
          opportunityId: "merkl_override_fixture_1",
          chain: "base",
          protocolId: "yo",
          protocolName: "YO",
          name: "YO USDC vault",
          family: "stable_yield",
          mappedStrategyId: "stablecoin_spread_loop",
          executionSurface: "stableCarry",
          hasStableExposure: true,
          entryTokenSymbols: ["USDC"],
          tokenSymbols: ["USDC"],
          campaignRemainingHours: 72,
          aprPct: 120,
          nativeAprPct: 80,
          tvlUsd: 10_000_000,
          score: 70,
          overfitRisk: "low",
          protocolBinding: {
            vaultAddress: "0x00000000000000000000000000000000000000b1",
            assetAddress,
            shareTokenAddress: "0x00000000000000000000000000000000000000c1",
            assetSymbol: "USDC",
          },
        },
      ],
    },
    inventorySnapshot: {
      tokens: [
        {
          chain: "base",
          ticker: "USDC",
          token: assetAddress,
          actual: "10000000",
          actualDecimal: 10,
          estimatedUsd: 10,
          status: "available",
        },
      ],
      native: [
        {
          chain: "base",
          asset: "ETH",
          actual: "10000000000000000",
          actualDecimal: 0.01,
          estimatedUsd: 30,
          status: "available",
        },
      ],
    },
  });

  assert.equal(queue.summary.autoExecutableNowCount, 1);
  const [queueItem] = queue.queue;
  assert.equal(queueItem.autoEntry.autoExecute, true);
  assert.equal(queueItem.executionReadiness.status, "inventory_ready");

  const intent = buildTinyLiveCanaryIntent({
    strategyId: queueItem.mappedStrategyId,
    chain: queueItem.chain,
    amountUsd: 10,
    microCanaryStatus: "minimal_live_proof_exists",
    now: NOW,
    metadata: {
      expectedNetUsd: 10,
      merklQueueId: queueItem.queueId,
      merklOpportunityId: queueItem.opportunityId,
      exitPath: ["deposit_asset_for_shares", "withdraw_or_redeem_shares"],
      advisory: advisorySurfaceBlock,
    },
  });

  const policy = await evaluateIntentPolicies({
    intent,
    auditRecords: [],
    riskContext: { microCanaryStatus: "minimal_live_proof_exists" },
    now: NOW,
    killSwitchPath: null,
  });

  assert.equal(policy.decision, "ALLOW");
  assert.equal(policy.blockers.includes("phase3_evidence_missing"), false);
  assert.equal(policy.effectiveIntent.metadata.advisory.adviceAuthority, "commit_time_guard");
});
