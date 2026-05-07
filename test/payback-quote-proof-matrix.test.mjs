import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";
import { buildPaybackQuoteProofMatrix } from "../src/executor/payback/quote-proof-matrix.mjs";

const ZERO_TOKEN = "0x0000000000000000000000000000000000000000";

function quote({ srcChain, dstChain, amount = "1000", observedAt = "2026-05-07T00:00:00.000Z" }) {
  return {
    observedAt,
    route: {
      srcChain,
      dstChain,
      srcToken: WBTC_OFT_TOKEN,
      dstToken: dstChain === "bitcoin" ? ZERO_TOKEN : WBTC_OFT_TOKEN,
    },
    routeKey: `${srcChain}:${WBTC_OFT_TOKEN}->${dstChain}:${dstChain === "bitcoin" ? ZERO_TOKEN : WBTC_OFT_TOKEN}`,
    quoteType: dstChain === "bitcoin" ? "offramp" : "layerZero",
    amount,
    outputAmount: amount,
    fees: "0",
    executionFees: "0",
    txValueWei: "1",
    txDataBytes: 452,
    estimatedTimeInSecs: 60,
    feeRatio: 0,
    grossOutputRatio: 1,
  };
}

function failure({ srcChain, dstChain, observedAt = "2026-05-07T00:01:00.000Z" }) {
  return {
    observedAt,
    route: {
      srcChain,
      dstChain,
      srcToken: WBTC_OFT_TOKEN,
      dstToken: dstChain === "bitcoin" ? ZERO_TOKEN : WBTC_OFT_TOKEN,
    },
    routeKey: `${srcChain}->${dstChain}`,
    amount: "1000",
    ok: false,
    error: {
      name: "GatewayError",
      message: "QUOTE_AMOUNT_TOO_LOW",
      details: {
        status: 400,
      },
    },
  };
}

test("payback quote proof matrix covers official chains without execution eligibility", () => {
  const matrix = buildPaybackQuoteProofMatrix({
    officialChains: ["base", "bob", "optimism"],
    reserveChain: "base",
    preMinimumCompositePreview: {
      status: "preview",
      reason: "cost_only_pre_minimum",
      executionEligible: false,
      intentEligible: false,
      previewInputSats: 50_000,
      estimatedOfframpCostSats: 465,
      satsToMinimumAfterCosts: 50_345,
    },
    gatewayQuotes: [
      quote({ srcChain: "base", dstChain: "bob" }),
      quote({ srcChain: "bob", dstChain: "bitcoin" }),
    ],
    gatewayFailures: [
      failure({ srcChain: "optimism", dstChain: "bob" }),
    ],
    now: "2026-05-07T00:02:00.000Z",
  });

  assert.equal(matrix.readOnly, true);
  assert.equal(matrix.executionEligible, false);
  assert.equal(matrix.intentEligible, false);
  assert.equal(matrix.rows.length, 3);
  assert.deepEqual(matrix.statusCounts, {
    cost_preview_available: 1,
    quote_proven: 1,
    quote_blocked: 1,
  });
  assert.equal(matrix.rows[0].chain, "base");
  assert.equal(matrix.rows[0].status, "cost_preview_available");
  assert.equal(matrix.rows[0].evidence.currentRoutePreview.executionEligible, false);
  assert.equal(matrix.rows[1].chain, "bob");
  assert.equal(matrix.rows[1].evidence.toBob.status, "not_required");
  assert.equal(matrix.rows[2].status, "quote_blocked");
  assert.equal(matrix.rows[2].evidence.toBob.status, "failure_found");
});

test("payback quote proof matrix records missing proof instead of inventing route readiness", () => {
  const matrix = buildPaybackQuoteProofMatrix({
    officialChains: ["sei"],
    reserveChain: "base",
    gatewayQuotes: [
      quote({ srcChain: "bob", dstChain: "bitcoin" }),
    ],
  });

  assert.equal(matrix.rows[0].status, "missing_quote_proof");
  assert.equal(matrix.rows[0].evidence.toBob.status, "missing_quote_proof");
  assert.equal(matrix.rows[0].evidence.bobToBitcoin.status, "quote_found");
});
