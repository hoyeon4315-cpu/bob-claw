import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface } from "ethers";
import {
  buildAaveProtocolCanaryPlan,
  executeAaveProtocolCanaryPlan,
  resolveAavePoolAddress,
  selectAaveQueueItem,
} from "../src/executor/helpers/aave-protocol-canary.mjs";

const AAVE_PROVIDER_INTERFACE = new Interface([
  "function getPool() view returns (address)",
]);

test("aave protocol canary resolves pool address through the addresses provider", async () => {
  const poolAddress = await resolveAavePoolAddress({
    chain: "ethereum",
    binding: {
      poolAddressProviderAddress: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
    },
    simulateTransactionCallImpl: async () => ({
      returnData: AAVE_PROVIDER_INTERFACE.encodeFunctionResult("getPool", ["0x1111111111111111111111111111111111111111"]),
    }),
  });

  assert.equal(poolAddress, "0x1111111111111111111111111111111111111111");
});

test("aave protocol canary selects binding-ready item and builds approve/supply plan", async () => {
  const queue = {
    queue: [
      {
        queueId: "merkl:eth-aave",
        opportunityId: "eth-aave",
        chain: "ethereum",
        protocolId: "aave",
        name: "Lend rsETH on Aave",
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        protocolBindingPlan: {
          status: "binding_ready",
          bindingKind: "aave_v3_pool_supply_withdraw",
          resolvedBinding: {
            assetAddress: "0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7",
            aTokenAddress: "0x2D62109243b87C4bA3EE7bA1D91B0dD0A074d7b1",
            poolAddressProviderAddress: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
            marketName: "proto_mainnet_v3",
            assetSymbol: "rsETH",
            assetDecimals: 18,
            aTokenSymbol: "aEthrsETH",
          },
        },
      },
    ],
  };
  const queueItem = selectAaveQueueItem(queue, { opportunityId: "eth-aave" });
  const plan = await buildAaveProtocolCanaryPlan({
    queueItem,
    senderAddress: "0x2222222222222222222222222222222222222222",
    amount: "1000000000000000",
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    simulateTransactionCallImpl: async () => ({
      returnData: AAVE_PROVIDER_INTERFACE.encodeFunctionResult("getPool", ["0x1111111111111111111111111111111111111111"]),
    }),
    now: "2026-04-23T00:00:00.000Z",
  });

  assert.equal(plan.marketName, "proto_mainnet_v3");
  assert.equal(plan.poolAddress, "0x1111111111111111111111111111111111111111");
  assert.equal(plan.amountUsd, 0.001);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].intent.intentType, "approve_exact");
  assert.equal(plan.steps[1].intent.intentType, "aave_supply");
  assert.equal(plan.minimumRedeemAssetDelta, "950000000000000");
});

test("aave protocol canary accepts asset-spent proof when share token delta is opaque", async () => {
  const plan = {
    schemaVersion: 1,
    observedAt: "2026-04-24T00:00:00.000Z",
    strategyId: "gateway_native_asset_conversion_sleeve",
    planStatus: "ready",
    chain: "ethereum",
    senderAddress: "0x2222222222222222222222222222222222222222",
    opportunityId: "eth-aave-rlusd",
    protocolId: "aave",
    bindingKind: "aave_v3_pool_supply_withdraw",
    name: "Lend RLUSD on Aave Horizon",
    poolAddress: "0x1111111111111111111111111111111111111111",
    poolAddressProviderAddress: "0x3333333333333333333333333333333333333333",
    marketName: "proto_mainnet_v3",
    assetAddress: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD",
    shareTokenAddress: "0xE3190143Eb552456F88464662f0c0C4aC67A77eB",
    amount: "250",
    amountUsd: 25,
    minimumReturnBps: 9500,
    minimumRedeemAssetDelta: "237",
    asset: {
      token: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD",
      ticker: "RLUSD",
      family: "stablecoin",
      decimals: 18,
      chain: "ethereum",
      isNative: false,
    },
    shareAsset: {
      token: "0xE3190143Eb552456F88464662f0c0C4aC67A77eB",
      ticker: "aHorRwaRLUSD",
      family: "protocol_share",
      decimals: 18,
      chain: "ethereum",
      isNative: false,
    },
    steps: [
      { id: "approve_asset_to_pool", intent: { tx: {}, amountUsd: 0 } },
      { id: "supply_asset_to_pool", intent: { tx: { data: "0x", gasLimit: "1" }, amountUsd: 25 } },
    ],
  };
  const balances = new Map([
    [`${plan.asset.token.toLowerCase()}:0`, "1000"],
    [`${plan.shareAsset.token.toLowerCase()}:0`, "0"],
    [`${plan.shareAsset.token.toLowerCase()}:1`, "0"],
    [`${plan.asset.token.toLowerCase()}:1`, "750"],
    [`${plan.shareAsset.token.toLowerCase()}:2`, "0"],
  ]);
  const calls = new Map();
  const execution = await executeAaveProtocolCanaryPlan({
    plan,
    sendCommand: async () => ({
      status: "ok",
      broadcast: { txHash: "0xtx" },
    }),
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    readErc20BalanceImpl: async (_chain, token) => {
      const lower = token.toLowerCase();
      const index = calls.get(lower) || 0;
      calls.set(lower, index + 1);
      return {
        rpcUrl: "memory",
        balance: balances.get(`${lower}:${index}`) || "0",
      };
    },
    settlementTimeoutMs: 0,
    sleepImpl: async () => {},
    exitAfterProof: false,
  });

  assert.equal(execution.settlementStatus, "position_opened");
  assert.equal(execution.shareProof.status, "unproven_timeout");
  assert.equal(execution.supplyProof.status, "delivered");
  assert.equal(execution.positionProof.proofSource, "erc20_balance_delta");
  assert.equal(execution.positionProof.observedDelta, "250");
});
