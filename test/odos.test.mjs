import assert from "node:assert/strict";
import { test } from "node:test";
import { canQuoteWithOdos, normalizeOdosQuote, ODOS_NATIVE_TOKEN } from "../src/dex/odos.mjs";
import { ZERO_TOKEN } from "../src/assets/tokens.mjs";

test("Odos support gate maps native EVM token and rejects unsupported chains", () => {
  const native = canQuoteWithOdos("base", ZERO_TOKEN);
  assert.equal(native.ok, true);
  assert.equal(native.inputToken, ODOS_NATIVE_TOKEN);

  const unsupported = canQuoteWithOdos("bob", "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c");
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.reason, "odos_chain_not_supported");
});

test("Odos quote normalization stores executable quote fields", () => {
  const record = normalizeOdosQuote({
    chain: "base",
    source: "gateway_dst_leg",
    amount: "10000",
    inputToken: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    outputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    outputTicker: "USDC",
    outputDecimals: 6,
    result: {
      latencyMs: 123,
      body: {
        outAmounts: ["7282809"],
        inValues: [7.27],
        outValues: [7.28],
        netOutValue: 7.276,
        gasEstimate: 394656,
        gasEstimateValue: 0.0053,
        priceImpact: 0,
        percentDiff: 0.07,
        gweiPerGas: 0.006,
        blockNumber: 44528469,
        pathId: "path",
      },
    },
  });

  assert.equal(record.provider, "odos");
  assert.equal(record.chainId, 8453);
  assert.equal(record.outputAmount, "7282809");
  assert.equal(record.gasEstimateValueUsd, 0.0053);
  assert.equal(record.pathId, "path");
});
