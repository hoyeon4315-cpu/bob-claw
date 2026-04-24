import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDefaultGatewayNativeAssetConversionSleeveConfig,
  evaluateGatewayNativeAssetConversionSleeveAdapter,
} from "../src/strategy/gateway-native-asset-conversion-sleeve-adapter.mjs";

test("gateway native asset conversion sleeve stays shadow until signer-backed receipts exist", () => {
  const result = evaluateGatewayNativeAssetConversionSleeveAdapter({
    config: buildDefaultGatewayNativeAssetConversionSleeveConfig(),
    receipts: [
      {
        strategyId: "gateway_native_asset_conversion_sleeve",
        source: "shadow",
        txHash: null,
      },
    ],
  });

  assert.equal(result.strategyId, "gateway_native_asset_conversion_sleeve");
  assert.equal(result.mode, "shadow");
  assert.equal(result.shadowReady, true);
  assert.equal(result.liveReady, false);
  assert.deepEqual(result.blockers, ["insufficient_signer_backed_receipts"]);
  assert.equal(result.signerBackedCount, 0);
});

test("gateway native asset conversion sleeve marks live-ready after signer-backed receipts", () => {
  const result = evaluateGatewayNativeAssetConversionSleeveAdapter({
    config: buildDefaultGatewayNativeAssetConversionSleeveConfig(),
    receipts: [
      {
        strategyId: "gateway_native_asset_conversion_sleeve",
        source: "signer",
        txHash: "0xaaa",
      },
      {
        strategyId: "gateway_native_asset_conversion_sleeve",
        lifecycle: { txHash: "0xbbb" },
      },
    ],
  });

  assert.equal(result.mode, "live");
  assert.equal(result.shadowReady, false);
  assert.equal(result.liveReady, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.signerBackedCount, 2);
});
