import assert from "node:assert/strict";
import { test } from "node:test";
import { bitcoinFeeSats, bitcoinFeeUsd, buildBitcoinFeeSnapshot } from "../src/bitcoin/fees.mjs";

test("bitcoin fee model converts sat/vB into sats", () => {
  assert.equal(bitcoinFeeSats({ feeRateSatVb: 4, vbytes: 180 }), 720);
});

test("bitcoin fee model converts sats into USD", () => {
  assert.equal(bitcoinFeeUsd({ feeRateSatVb: 4, vbytes: 180, btcUsd: 72_982 }), 0.5254704);
});

test("bitcoin fee snapshot uses half-hour fee as the conservative selected rate", () => {
  const snapshot = buildBitcoinFeeSnapshot({
    fees: {
      fastestFee: 8,
      halfHourFee: 4,
      hourFee: 3,
      economyFee: 2,
      minimumFee: 1,
    },
    btcUsd: 72_982,
    latencyMs: 123,
    source: "test",
    vbytes: 180,
  });

  assert.equal(snapshot.source, "test");
  assert.equal(snapshot.selectedFeeRateSatVb, 4);
  assert.equal(snapshot.estimatedFeeSats, 720);
  assert.equal(snapshot.estimatedFeeUsd, 0.5254704);
  assert.equal(snapshot.model, "estimated_single_input_single_output");
});
