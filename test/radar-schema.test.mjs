import assert from "node:assert/strict";
import test from "node:test";

import {
  validateExecutableCandidate,
  validateOpportunityObservation,
  validateOpportunityRealizationRecord,
  validatePortableOpportunityPacket,
  validateStrategyEpisode,
} from "../src/strategy/radar/schema/index.mjs";

const baseObservation = Object.freeze({
  obsId: "obs_001",
  observedAt: "2026-04-30T12:00:00.000Z",
  sourceList: ["raw_evm_rpc", "etherscan_v2"],
  sourceFreshness: Object.freeze({
    raw_evm_rpc: Object.freeze({ observedHead: 123456n.toString(), providerHead: 123456n.toString() }),
    etherscan_v2: Object.freeze({ observedHead: 123455n.toString(), providerHead: 123456n.toString() }),
  }),
  walletClusterId: "cluster_alpha",
  clusterMethod: "custom_indexer",
  clusterConfidence: 0.82,
  chain: "base",
  protocolId: "aerodrome",
  poolOrMarket: "base:0xpool",
  sourceTxs: ["0xentry", "0xclaim", "0xexit"],
  rawEventPayloadHash: "sha256:observed-payload",
  executionPath: "gateway_destination",
  discoveryClaimType: "behavior_observed",
});

test("radar observation schema accepts complete behavior-only observations", () => {
  const result = validateOpportunityObservation(baseObservation);

  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.value.discoveryClaimType, "behavior_observed");
  assert.equal(Object.isFrozen(result.value), true);
});

test("radar observation schema rejects missing fields and invalid enums", () => {
  const result = validateOpportunityObservation({
    ...baseObservation,
    obsId: undefined,
    executionPath: "solana_executor",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, ["missing_obsId", "invalid_executionPath"]);
  assert.equal(result.value, null);
});

test("strategy episode schema keeps external pnl claims separate from replay proof", () => {
  const result = validateStrategyEpisode({
    episodeId: "episode_001",
    derivedFrom: ["obs_001"],
    strategyCategory: "campaign_reward_farming",
    hypothesisAssumptions: ["entry and exit belong to the same wallet cluster"],
    falsifiers: [{ name: "cex_hop", result: false }],
    referenceWalletPnlClaim: { valueSats: "700", source: "label_claim", verifiedBy: null },
    selfReplayPnlSats: null,
    pnlClosurePathProof: [],
    pnlClosureStatus: "unknown",
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.referenceWalletPnlClaim.verified, false);
  assert.equal(result.value.selfReplayPnlSats, null);
});

test("portable packet schema requires replay and portability evidence fields to be present", () => {
  const result = validatePortableOpportunityPacket({
    packetId: "packet_001",
    episodeIds: ["episode_001"],
    portabilityWalletSet: ["cluster_alpha", "cluster_beta"],
    portabilityClusterIndependenceProof: "distinct_funding_sources",
    rewardTokenSymbol: "TOKEN",
    rewardEmissionPerBlock: null,
    rewardEmissionEndBlock: null,
    rewardVestingSchedule: "none_observed",
    rewardLockupSeconds: 0,
    rewardTokenLiquidityDepthUsd: null,
    rewardTokenSlippageAtSize: null,
    rewardTokenHaircutSats: "0",
    oracleSource: "chainlink",
    oracleStalenessSecondsMax: 60,
    oracleManipulationCostUsd: null,
    capacityAtProposedSize: "unknown",
    slippageSimAtSize: null,
    slippageSimAt2x: null,
    slippageSimAt5x: null,
    poolUtilizationNow: null,
    borrowRateCurveSnapshot: null,
    withdrawalQueueDepth: null,
    redemptionLatencySecondsP50: null,
    redemptionLatencySecondsP99: null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.packetId, "packet_001");
});

test("executable candidate schema preserves review-only blockers", () => {
  const result = validateExecutableCandidate({
    candidateId: "candidate_001",
    packetId: "packet_001",
    proposedSizeBtc: "0.0001",
    committedCapBtc: "0.0002",
    executionPath: "post_gateway_manual_bridge",
    protocolAuditStatus: "unknown",
    protocolAuditFirms: [],
    auditReportHash: [],
    protocolAgeDays: null,
    protocolDeployTxHash: null,
    protocolTvlNow: null,
    protocolTvlPeak: null,
    protocolTvlDrawdown30d: null,
    protocolExploitHistory: [],
    reentrancyStaticAnalysisScore: null,
    governanceTokenSupply: null,
    governanceQuorum: null,
    governanceTimelockSeconds: null,
    governanceMultisigThreshold: null,
    mevExposureScore: null,
    privateRpcUsed: false,
    bundleSubmissionVenue: null,
    sanctionsFlag: "unknown",
    taxJurisdictionFlag: "unknown",
    bridgeRouteSanctionsCheck: "unknown",
    relayerJurisdiction: null,
    custodianEntity: null,
    gatewayQuoteId: null,
    gatewayFeeSats: null,
    gatewayLatencyObserved: null,
    relayerLivenessProof: null,
    lpEscrowAddress: null,
    policyHashAtEvaluation: null,
    killSwitchState: "unknown",
    capUtilizationAtEvaluationBps: null,
    blockers: ["manual_bridge_execution_not_supported"],
    gateStatus: "review_only",
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.gateStatus, "review_only");
  assert.deepEqual(result.value.blockers, ["manual_bridge_execution_not_supported"]);
});

test("realization record separates strategy realized pnl from payback delivery", () => {
  const result = validateOpportunityRealizationRecord({
    runId: "run_001",
    candidateId: "candidate_001",
    entryReceipts: [{ chainId: 8453, txHash: "0xentry", blockHash: "0xblock", blockNumber: 1, receiptRoot: null, gasUsed: "100", effectiveGasPrice: "1", valueIn: "1000", valueOut: "990" }],
    claimReceipts: [],
    exitReceipts: [{ chainId: 8453, txHash: "0xexit", blockHash: "0xblock2", blockNumber: 2, receiptRoot: null, gasUsed: "100", effectiveGasPrice: "1", valueIn: "990", valueOut: "1100" }],
    userOpHash: null,
    bundlerHash: null,
    gasCostSats: "10",
    bridgeCostSats: "0",
    swapSlippageSats: "5",
    rewardTokenHaircutSats: "0",
    grossPnlSats: "120",
    netRealizedPnlSats: "105",
    btcPaybackTxid: null,
    btcPaybackBlockHash: null,
    btcPaybackConfirmations: 0,
    pnlClosureStatus: "closed",
    sandwichDetectedPostTrade: false,
    priceImpactBps: 2,
    observedAt: "2026-04-30T12:01:00.000Z",
    settledAt: "2026-04-30T12:02:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.lifecycle.strategyRealized, true);
  assert.equal(result.value.lifecycle.paybackDelivered, false);
});
