import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildErc4626ProtocolCanaryPlan,
  selectErc4626QueueItem,
} from "../src/executor/helpers/erc4626-protocol-canary.mjs";

test("erc4626 protocol canary selects binding-ready queue item and builds approve/deposit plan", async () => {
  const queue = {
    queue: [
      {
        queueId: "merkl:base-morpho",
        opportunityId: "base-morpho",
        chain: "base",
        protocolId: "morpho",
        name: "Supply USDC",
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        protocolBindingPlan: {
          status: "binding_ready",
          bindingKind: "erc4626_vault_supply_withdraw",
          resolvedBinding: {
            vaultAddress: "0x1111111111111111111111111111111111111111",
            assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            shareTokenAddress: "0x1111111111111111111111111111111111111111",
            assetSymbol: "USDC",
            assetDecimals: 6,
            shareTokenSymbol: "steakUSDC",
          },
        },
      },
    ],
  };
  const queueItem = selectErc4626QueueItem(queue, { chain: "base" });
  const plan = await buildErc4626ProtocolCanaryPlan({
    queueItem,
    senderAddress: "0x2222222222222222222222222222222222222222",
    amount: "10000",
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    readErc20AllowanceImpl: async () => ({ allowance: 0n, rpcUrl: "memory" }),
    now: "2026-04-23T00:00:00.000Z",
  });

  assert.equal(plan.strategyId, "gateway_native_asset_conversion_sleeve");
  assert.equal(plan.amountUsd, 0.01);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].intent.intentType, "approve_exact");
  assert.equal(plan.steps[1].intent.intentType, "erc4626_deposit");
  assert.equal(plan.minimumRedeemAssetDelta, "9500");
});

test("erc4626 protocol canary auto-selection prefers inventory-ready candidates", () => {
  const queue = {
    queue: [
      {
        queueId: "merkl:eth-morpho",
        opportunityId: "eth-morpho",
        rank: 1,
        chain: "ethereum",
        protocolId: "morpho",
        entryAssets: ["USDC"],
        protocolBindingPlan: {
          status: "binding_ready",
          bindingKind: "erc4626_vault_supply_withdraw",
          resolvedBinding: {
            vaultAddress: "0x1111111111111111111111111111111111111111",
            assetAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            shareTokenAddress: "0x1111111111111111111111111111111111111111",
          },
        },
      },
      {
        queueId: "merkl:base-morpho",
        opportunityId: "base-morpho",
        rank: 2,
        chain: "base",
        protocolId: "morpho",
        entryAssets: ["USDC"],
        protocolBindingPlan: {
          status: "binding_ready",
          bindingKind: "erc4626_vault_supply_withdraw",
          resolvedBinding: {
            vaultAddress: "0x2222222222222222222222222222222222222222",
            assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            shareTokenAddress: "0x2222222222222222222222222222222222222222",
          },
        },
      },
    ],
  };
  const inventorySnapshot = {
    native: [{ chain: "base", actual: "100", actualDecimal: 0.001 }],
    tokens: [{
      chain: "base",
      ticker: "USDC",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      actual: "414771",
      actualDecimal: 0.414771,
    }],
  };

  const queueItem = selectErc4626QueueItem(queue, {
    inventorySnapshot,
    now: "2026-04-24T02:00:00.000Z",
  });

  assert.equal(queueItem.opportunityId, "base-morpho");
  assert.equal(queueItem.executionReadiness.status, "inventory_ready");
});

test("erc4626 protocol canary also supports Euler eVault bindings", async () => {
  const queue = {
    queue: [
      {
        queueId: "merkl:eth-euler",
        opportunityId: "eth-euler",
        chain: "ethereum",
        protocolId: "euler",
        name: "Supply PYUSD",
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        protocolBindingPlan: {
          status: "binding_ready",
          bindingKind: "euler_evault_deposit_withdraw",
          resolvedBinding: {
            vaultAddress: "0xba98fC35C9dfd69178AD5dcE9FA29c64554783b5",
            assetAddress: "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8",
            assetSymbol: "PYUSD",
            assetDecimals: 6,
            shareTokenSymbol: "ePYUSD-6",
          },
        },
      },
    ],
  };

  const queueItem = selectErc4626QueueItem(queue, { opportunityId: "eth-euler" });
  const plan = await buildErc4626ProtocolCanaryPlan({
    queueItem,
    senderAddress: "0x2222222222222222222222222222222222222222",
    amount: "10000",
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    readErc20AllowanceImpl: async () => ({ allowance: 0n, rpcUrl: "memory" }),
    now: "2026-04-23T00:00:00.000Z",
  });

  assert.equal(queueItem.protocolId, "euler");
  assert.equal(plan.bindingKind, "euler_evault_deposit_withdraw");
  assert.equal(plan.shareTokenAddress, "0xba98fC35C9dfd69178AD5dcE9FA29c64554783b5");
});

test("erc4626 protocol canary skips approval when existing allowance covers amount", async () => {
  const queueItem = {
    queueId: "merkl:eth-usdt",
    opportunityId: "eth-usdt",
    chain: "ethereum",
    protocolId: "morpho",
    name: "Supply USDT",
    mappedStrategyId: "gateway_native_asset_conversion_sleeve",
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: "erc4626_vault_supply_withdraw",
      resolvedBinding: {
        vaultAddress: "0xbeef003C68896c7D2c3c60d363e8d71a49Ab2bf9",
        assetAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        shareTokenAddress: "0xbeef003C68896c7D2c3c60d363e8d71a49Ab2bf9",
        assetSymbol: "USDT",
        assetDecimals: 6,
      },
    },
  };

  const plan = await buildErc4626ProtocolCanaryPlan({
    queueItem,
    senderAddress: "0x2222222222222222222222222222222222222222",
    amount: "50000000",
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    readErc20AllowanceImpl: async () => ({ allowance: 62436737n, rpcUrl: "memory" }),
    now: "2026-04-24T00:00:00.000Z",
  });

  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].id, "deposit_asset_to_vault");
  assert.equal(plan.allowanceBefore.skippedApproval, true);
});
