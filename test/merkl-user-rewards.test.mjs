import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMerklUserRewardsSlice,
  buildMerklUserRewardsUrl,
  normalizeMerklUserRewardsPayload,
  summarizeMerklUserRewards,
} from "../src/status/merkl-user-rewards-slice.mjs";

const SAMPLE_PAYLOAD = [
  {
    chain: { id: 8453, name: "Base" },
    rewards: [
      {
        root: "0xbase",
        distributionChainId: 8453,
        recipient: "0xabc",
        amount: "1976426788831220933",
        claimed: "0",
        pending: "124109721931587365",
        proofs: ["0x01", "0x02"],
        token: {
          chainId: 8453,
          address: "0x1925450f5e5fB974b0AaE1F3408cF5286FBD1A72",
          decimals: 18,
          symbol: "YO",
          price: 0.09,
        },
        breakdowns: [{ campaignId: "0xbase-campaign" }],
      },
    ],
  },
  {
    chain: { id: 1, name: "Ethereum" },
    rewards: [
      {
        root: "0xeth",
        distributionChainId: 1,
        recipient: "0xabc",
        amount: "11254194174006364",
        claimed: "0",
        pending: "0",
        proofs: ["0x03"],
        token: {
          chainId: 1,
          address: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD",
          decimals: 18,
          symbol: "RLUSD",
          price: 0.9998506868446593,
        },
        breakdowns: [{ campaignId: "0xeth-campaign" }],
      },
    ],
  },
];

test("buildMerklUserRewardsUrl uses chainId list and reloadChainId", () => {
  const url = buildMerklUserRewardsUrl({
    apiBase: "https://api.merkl.xyz/",
    address: "0xabc",
    chainIds: [8453, 1, 10],
    reloadChainId: 8453,
  });

  assert.equal(
    url,
    "https://api.merkl.xyz/v4/users/0xabc/rewards?chainId=8453%2C1%2C10&reloadChainId=8453",
  );
});

test("normalizeMerklUserRewardsPayload separates claimable from pending rewards", () => {
  const rows = normalizeMerklUserRewardsPayload(SAMPLE_PAYLOAD, {
    observedAt: "2026-05-06T09:10:30.973Z",
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    chainId: 8453,
    chainName: "Base",
    distributionChainId: 8453,
    recipient: "0xabc",
    tokenAddress: "0x1925450f5e5fB974b0AaE1F3408cF5286FBD1A72",
    tokenSymbol: "YO",
    tokenDecimals: 18,
    tokenPriceUsd: 0.09,
    amountRaw: "1976426788831220933",
    claimedRaw: "0",
    claimableRaw: "1976426788831220933",
    pendingRaw: "124109721931587365",
    amount: 1.976426788831221,
    claimed: 0,
    claimable: 1.976426788831221,
    pending: 0.12410972193158736,
    amountUsd: 0.1778784109948099,
      claimedUsd: 0,
      claimableUsd: 0.1778784109948099,
      pendingUsd: 0.011169874973842862,
      root: "0xbase",
      proofCount: 2,
      breakdownCount: 1,
      campaignIds: ["0xbase-campaign"],
      isClaimable: true,
      status: "claimable",
      observedAt: "2026-05-06T09:10:30.973Z",
    });
});

test("summarizeMerklUserRewards totals by chain and builds deterministic claim plan", () => {
  const rows = normalizeMerklUserRewardsPayload(SAMPLE_PAYLOAD, {
    observedAt: "2026-05-06T09:10:30.973Z",
  });
  const summary = summarizeMerklUserRewards(rows, {
    minClaimUsd: 0.1,
    maxClaimCostUsdByChainId: { 8453: 0.02, 1: 8 },
    distributorsByChainId: { 8453: "0x0000000000000000000000000000000000000001" },
  });

  assert.equal(summary.rewardCount, 2);
  assert.equal(summary.claimableRewardCount, 2);
  assert.equal(summary.totalClaimableUsd, 0.18913092476957333);
  assert.equal(summary.totalPendingUsd, 0.011169874973842862);
  assert.deepEqual(summary.byChain, {
    "1": {
      chainId: 1,
      chainName: "Ethereum",
      rewardCount: 1,
      claimableRewardCount: 1,
      totalClaimableUsd: 0.011252513774763426,
      totalPendingUsd: 0,
    },
    "8453": {
      chainId: 8453,
      chainName: "Base",
      rewardCount: 1,
      claimableRewardCount: 1,
      totalClaimableUsd: 0.1778784109948099,
      totalPendingUsd: 0.011169874973842862,
    },
  });
  assert.deepEqual(summary.claimPlan, {
    status: "ready",
    readyChainCount: 1,
    blockedChainCount: 1,
    totalReadyClaimableUsd: 0.1778784109948099,
    chains: [
      {
        chainId: 8453,
        chainName: "Base",
        status: "ready",
        claimableUsd: 0.1778784109948099,
        pendingUsd: 0.011169874973842862,
        rewardCount: 1,
        tokenSymbols: ["YO"],
        distributorAddress: "0x0000000000000000000000000000000000000001",
        estimatedClaimCostUsd: 0.02,
        blockers: [],
      },
      {
        chainId: 1,
        chainName: "Ethereum",
        status: "blocked",
        claimableUsd: 0.011252513774763426,
        pendingUsd: 0,
        rewardCount: 1,
        tokenSymbols: ["RLUSD"],
        distributorAddress: null,
        estimatedClaimCostUsd: 8,
        blockers: [
          "claimable_below_min_usd",
          "distributor_address_missing",
          "claim_cost_exceeds_claimable",
        ],
      },
    ],
  });
});

test("buildMerklUserRewardsSlice publishes compact dashboard fields", () => {
  const rows = normalizeMerklUserRewardsPayload(SAMPLE_PAYLOAD, {
    observedAt: "2026-05-06T09:10:30.973Z",
  });
  const slice = buildMerklUserRewardsSlice(rows, {
    generatedAt: "2026-05-06T09:11:00.000Z",
    minClaimUsd: 0.1,
    maxClaimCostUsdByChainId: { 8453: 0.02, 1: 8 },
    distributorsByChainId: { 8453: "0x0000000000000000000000000000000000000001" },
  });

  assert.equal(slice.status, "claim_ready");
  assert.equal(slice.rewardCount, 2);
  assert.equal(slice.claimableRewardCount, 2);
  assert.equal(slice.totalClaimableUsd, 0.18913092476957333);
  assert.equal(slice.claimPlan.readyChainCount, 1);
  assert.deepEqual(slice.topRewards.map((item) => item.tokenSymbol), ["YO", "RLUSD"]);
  assert.equal(slice.topRewards[0].proofCount, 2);
  assert.equal(slice.topRewards[0].campaignIds[0], "0xbase-campaign");
});
