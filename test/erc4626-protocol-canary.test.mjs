import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildErc4626ProtocolCanaryPlan,
  executeErc4626ProtocolCanaryPlan,
  selectErc4626QueueItem,
} from "../src/executor/helpers/erc4626-protocol-canary.mjs";
import { evGate } from "../src/executor/policy/ev-gate.mjs";

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
    assetCoverage: {
      status: "closed",
      ok: true,
      unknownAssetBalanceCount: 0,
      unknownTargetCount: 0,
      gaps: [],
      observedAt: "2026-04-23T00:00:00.000Z",
      sourceObservedAt: "2026-04-22T23:59:00.000Z",
      sourcePath: "dashboard/public/wallet-holdings.json",
    },
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    readErc20AllowanceImpl: async () => ({ allowance: 0n, rpcUrl: "memory" }),
    now: "2026-04-23T00:00:00.000Z",
  });

  assert.equal(plan.strategyId, "gateway_native_asset_conversion_sleeve");
  assert.equal(plan.amountUsd, 0.01);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].intent.intentType, "approve_exact");
  assert.equal(plan.steps[1].intent.intentType, "erc4626_deposit");
  assert.equal(plan.steps[1].intent.metadata.exposureAction, "open");
  assert.equal(plan.steps[1].intent.metadata.assetCoverage.status, "closed");
  assert.equal(plan.steps[1].intent.metadata.assetCoverage.sourceObservedAt, "2026-04-22T23:59:00.000Z");
  assert.equal(plan.minimumRedeemAssetDelta, "9500");
});

test("erc4626 Merkl tiny-live plan preserves parent EV evidence for exact approval policy", async () => {
  const plan = await buildErc4626ProtocolCanaryPlan({
    queueItem: {
      queueId: "merkl:base-morpho",
      opportunityId: "base-morpho",
      chain: "base",
      protocolId: "morpho",
      name: "Supply USDC",
      mappedStrategyId: "gateway_native_asset_conversion_sleeve",
      validationMode: "tiny_live_canary_only",
      aprPct: 25,
      campaignRemainingHours: 720,
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
    senderAddress: "0x2222222222222222222222222222222222222222",
    amount: "100000000",
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    readErc20AllowanceImpl: async () => ({ allowance: 0n, rpcUrl: "memory" }),
    now: "2026-05-10T00:00:00.000Z",
  });

  const approvalIntent = plan.steps[0].intent;
  const depositIntent = plan.steps[1].intent;
  assert.equal(depositIntent.executionReason, "merkl_canary_autopilot");
  assert.equal(depositIntent.metadata.tinyLiveCanary, true);
  assert.equal(approvalIntent.metadata.tinyLiveCanary, true);
  assert.equal(typeof approvalIntent.metadata.parentIntentHash, "string");
  assert.equal(typeof approvalIntent.metadata.parentEvEvidenceHash, "string");
  assert.equal(approvalIntent.metadata.parentIntent.intentType, "erc4626_deposit");
  assert.equal(approvalIntent.metadata.parentEvEvidence.allow, true);
  assert.equal(evGate(approvalIntent, null, { now: "2026-05-10T00:00:00.000Z" }).allow, true);
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
    tokens: [
      {
        chain: "base",
        ticker: "USDC",
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        actual: "414771",
        actualDecimal: 0.414771,
      },
    ],
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

test("erc4626 protocol canary resets partial allowance before exact approval", async () => {
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
    amount: "15000000",
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    readErc20AllowanceImpl: async () => ({ allowance: 10_000_000n, rpcUrl: "memory" }),
    now: "2026-04-24T00:00:00.000Z",
  });

  assert.equal(plan.steps.length, 3);
  assert.equal(plan.steps[0].id, "reset_asset_allowance");
  assert.equal(plan.steps[0].intent.approval.amount, "0");
  assert.equal(plan.steps[1].id, "approve_asset_to_vault");
  assert.equal(plan.steps[1].intent.approval.amount, "15000000");
  assert.equal(plan.steps[2].id, "deposit_asset_to_vault");
  assert.equal(plan.allowanceBefore.resetBeforeApproval, true);
});

test("erc4626 protocol canary records signer policy rejection instead of throwing", async () => {
  const queueItem = {
    queueId: "merkl:base-yo",
    opportunityId: "base-yo",
    chain: "base",
    protocolId: "yo",
    name: "Deposit USDC to YO",
    mappedStrategyId: "gateway_native_asset_conversion_sleeve",
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: "erc4626_vault_supply_withdraw",
      resolvedBinding: {
        vaultAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
        assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        shareTokenAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
        assetSymbol: "USDC",
        assetDecimals: 6,
      },
    },
  };
  const plan = await buildErc4626ProtocolCanaryPlan({
    queueItem,
    senderAddress: "0x2222222222222222222222222222222222222222",
    amount: "1792834",
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    readErc20AllowanceImpl: async () => ({ allowance: 0n, rpcUrl: "memory" }),
    now: "2026-05-01T22:51:40.000Z",
  });

  const execution = await executeErc4626ProtocolCanaryPlan({
    plan,
    readErc20BalanceImpl: async (chain, token) => ({
      balance: token.toLowerCase() === plan.assetAddress.toLowerCase() ? 2_000_000n : 0n,
      rpcUrl: "memory",
    }),
    sendCommand: async () => ({
      status: "rejected",
      policy: {
        blockers: ["max_consecutive_failures_reached"],
      },
    }),
  });

  assert.equal(execution.settlementStatus, "signer_rejected");
  assert.equal(execution.signerResult.status, "rejected");
  assert.equal(execution.stepResults[0].id, "approve_asset_to_vault");
  assert.equal(execution.error.name, "SignerRejected");
  assert.equal(execution.error.policy.blockers[0], "max_consecutive_failures_reached");
});

test("erc4626 protocol canary closes capital-audit pair before redeem intent", async () => {
  const queueItem = {
    queueId: "merkl:base-morpho",
    opportunityId: "base-morpho",
    chain: "base",
    protocolId: "morpho",
    name: "Deposit USDC to Morpho vault",
    mappedStrategyId: "gateway_native_asset_conversion_sleeve",
    validationMode: "tiny_live_canary_only",
    aprPct: 100,
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: "erc4626_vault_supply_withdraw",
      resolvedBinding: {
        vaultAddress: "0x1111111111111111111111111111111111111111",
        assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        shareTokenAddress: "0x1111111111111111111111111111111111111111",
        assetSymbol: "USDC",
        assetDecimals: 6,
        shareTokenSymbol: "mUSDC",
      },
    },
  };
  const plan = await buildErc4626ProtocolCanaryPlan({
    queueItem,
    senderAddress: "0x2222222222222222222222222222222222222222",
    amount: "1000000",
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    readErc20AllowanceImpl: async () => ({ allowance: 2_000_000n, rpcUrl: "memory" }),
    now: "2026-05-14T00:00:00.000Z",
  });
  const order = [];
  const closures = [];
  let depositSent = false;
  let redeemSent = false;

  const execution = await executeErc4626ProtocolCanaryPlan({
    plan,
    dataDir: "/tmp/erc4626-capital-audit-test",
    appendCapitalAuditPairImpl: async (_dataDir, closure) => {
      order.push(`append:${closure.strategyId}:${closure.status}`);
      closures.push(closure);
      return "/tmp/erc4626-capital-audit-test/capital-audit-pairs.jsonl";
    },
    readErc20BalanceImpl: async (_chain, token) => {
      const normalized = token.toLowerCase();
      if (normalized === plan.assetAddress.toLowerCase()) {
        return { balance: redeemSent ? 1_950_000n : 2_000_000n, rpcUrl: "memory" };
      }
      return { balance: depositSent && !redeemSent ? 1_000_000n : 0n, rpcUrl: "memory" };
    },
    estimateGasImpl: async () => ({ gasUnits: 50_000 }),
    sendCommand: async ({ message }) => {
      order.push(`send:${message.intent.intentType}`);
      if (message.intent.intentType === "erc4626_deposit") depositSent = true;
      if (message.intent.intentType === "erc4626_redeem") redeemSent = true;
      return {
        status: "ok",
        broadcast: { txHash: `0x${message.intent.intentType}` },
        receipt: { status: 1, transactionHash: `0x${message.intent.intentType}` },
        policy: { decision: "ALLOW", blockers: [] },
      };
    },
    sleepImpl: async () => {},
    settlementTimeoutMs: 1,
    pollIntervalMs: 0,
  });

  assert.equal(execution.settlementStatus, "delivered");
  assert.deepEqual(order, [
    "send:erc4626_deposit",
    "append:gateway_native_asset_conversion_sleeve:closed",
    "send:erc4626_redeem",
    "append:gateway_native_asset_conversion_sleeve:closed",
  ]);
  assert.equal(closures.length, 2);
  assert.equal(closures[0].stage, "post_reconciliation");
  assert.equal(closures[0].validation.ok, true);
  assert.equal(closures[1].validation.ok, true);
});
