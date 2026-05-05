import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildNativeDustFallbackPlan,
  shouldApplyNativeDustFallback,
} from "../src/executor/helpers/native-dust-fallback.mjs";

test("native dust fallback builds source native -> source USDC -> Base USDC -> Base wBTC.OFT plan", () => {
  const plan = buildNativeDustFallbackPlan({
    sourceChain: "sonic",
    sourceNativeBalance: "104688927175003930000",
    sourceNativeUsd: 4.69,
  });

  assert.equal(plan.status, "plan_ready");
  assert.equal(plan.sourceChain, "sonic");
  assert.equal(plan.targetChain, "base");
  assert.equal(plan.targetAsset, "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c");
  assert.deepEqual(
    plan.steps.map((step) => ({
      step: step.step,
      name: step.name,
      chain: step.chain,
      destinationChain: step.destinationChain || null,
      fromToken: step.fromToken,
      toToken: step.toToken,
    })),
    [
      {
        step: 1,
        name: "swap_native_to_usdc_on_source",
        chain: "sonic",
        destinationChain: null,
        fromToken: "0x0000000000000000000000000000000000000000",
        toToken: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894",
      },
      {
        step: 2,
        name: "route_usdc_to_base",
        chain: "sonic",
        destinationChain: "base",
        fromToken: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894",
        toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      },
      {
        step: 3,
        name: "swap_usdc_to_wbtc_on_base",
        chain: "base",
        destinationChain: null,
        fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        toToken: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
      },
    ],
  );
  assert.equal(plan.estimatedEndToEndCostUsd, 0.5);
  assert.equal(plan.estimatedNetUsd, 4.4555);
});

test("native dust fallback defers unsupported source stables with deterministic reason", () => {
  const plan = buildNativeDustFallbackPlan({
    sourceChain: "sei",
    sourceNativeBalance: "57345346894591515000",
    sourceNativeUsd: 3.39,
  });

  assert.equal(plan.status, "skip");
  assert.equal(plan.reason, "source_stable_token_unavailable");
});

test("native dust fallback applies only when non-Base native dust clears the threshold", () => {
  assert.equal(
    shouldApplyNativeDustFallback({
      sourceChain: "sonic",
      sourceNativeBalance: "104688927175003930000",
      sourceNativeUsd: 4.69,
      directConversionAvailable: false,
    }),
    true,
  );
  assert.equal(
    shouldApplyNativeDustFallback({
      sourceChain: "base",
      sourceNativeBalance: "1000000000000000000",
      sourceNativeUsd: 2,
      directConversionAvailable: false,
    }),
    false,
  );
  assert.equal(
    shouldApplyNativeDustFallback({
      sourceChain: "sonic",
      sourceNativeBalance: "1000000000000000",
      sourceNativeUsd: 0.49,
      directConversionAvailable: false,
    }),
    false,
  );
});
