import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface } from "ethers";
import {
  buildAaveProtocolCanaryPlan,
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
