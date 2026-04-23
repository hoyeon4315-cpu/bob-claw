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
    now: "2026-04-23T00:00:00.000Z",
  });

  assert.equal(plan.strategyId, "gateway_native_asset_conversion_sleeve");
  assert.equal(plan.amountUsd, 0.01);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].intent.intentType, "approve_exact");
  assert.equal(plan.steps[1].intent.intentType, "erc4626_deposit");
  assert.equal(plan.minimumRedeemAssetDelta, "9500");
});
