import assert from "node:assert/strict";
import { test } from "node:test";
import { acrossSupportsPair, acrossSpokePool, acrossTokenAddress } from "../src/config/across.mjs";
import { buildAcrossQuoteRequest, normalizeAcrossQuote } from "../src/bridge/across/quote.mjs";

test("acrossSupportsPair accepts Base<->Optimism USDC", () => {
  assert.equal(acrossSupportsPair({ srcChain: "base", dstChain: "optimism", ticker: "usdc" }), true);
});

test("acrossSupportsPair uses repo chain key bsc for BNB Chain", () => {
  assert.equal(acrossSupportsPair({ srcChain: "bsc", dstChain: "base", ticker: "usdc" }), true);
  assert.equal(acrossTokenAddress("bsc", "usdc"), "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");
});

test("acrossSupportsPair rejects unsupported chain", () => {
  assert.equal(acrossSupportsPair({ srcChain: "bob", dstChain: "base", ticker: "usdc" }), false);
});

test("acrossSupportsPair rejects unsupported ticker on chain", () => {
  assert.equal(acrossSupportsPair({ srcChain: "base", dstChain: "ethereum", ticker: "pepe" }), false);
});

test("buildAcrossQuoteRequest resolves token addresses and chainIds", () => {
  const req = buildAcrossQuoteRequest({
    srcChain: "base",
    dstChain: "optimism",
    ticker: "usdc",
    amount: "100000000",
    recipient: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
  });
  assert.equal(req.inputToken, acrossTokenAddress("base", "usdc"));
  assert.equal(req.outputToken, acrossTokenAddress("optimism", "usdc"));
  assert.equal(req.originChainId, 8453);
  assert.equal(req.destinationChainId, 10);
  assert.equal(req.amount, "100000000");
  assert.equal(req.allowUnmatchedDecimals, false);
});

test("buildAcrossQuoteRequest flags unmatched decimals for BSC USDC routes", () => {
  const req = buildAcrossQuoteRequest({
    srcChain: "bsc",
    dstChain: "base",
    ticker: "usdc",
    amount: "1000000000000000000",
  });
  assert.equal(req.originChainId, 56);
  assert.equal(req.destinationChainId, 8453);
  assert.equal(req.allowUnmatchedDecimals, true);
});

test("buildAcrossQuoteRequest throws on unsupported pair", () => {
  assert.throws(
    () => buildAcrossQuoteRequest({ srcChain: "bob", dstChain: "base", ticker: "usdc", amount: "1" }),
    /pair unsupported/,
  );
});

test("normalizeAcrossQuote builds quote from valid response", () => {
  const request = buildAcrossQuoteRequest({
    srcChain: "base",
    dstChain: "optimism",
    ticker: "usdc",
    amount: "100000000",
    recipient: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
  });
  const now = 1_714_000_000;
  const responseBody = {
    totalRelayFee: { pct: "2500000000000000", total: "250000" }, // 0.25%
    lpFee: { pct: "100000000000000" },
    outputAmount: "99750000",
    timestamp: now - 2,
    exclusiveRelayer: "0x0000000000000000000000000000000000000001",
    exclusivityDeadline: now + 60,
  };
  const normalized = normalizeAcrossQuote({ request, responseBody, now });
  assert.equal(normalized.quote.outputAmount, "99750000");
  assert.equal(normalized.quote.originChainId, 8453);
  assert.equal(normalized.quote.destinationChainId, 10);
  assert.ok(normalized.quote.fillDeadline > now + 119, "fillDeadline respects min window");
  assert.ok(normalized.quote.spokePoolOrigin.startsWith("0x"));
  assert.ok(Math.abs(normalized.quote.relayFeePct - 0.0025) < 1e-9);
});

test("normalizeAcrossQuote rejects relayer fee above policy cap", () => {
  const request = buildAcrossQuoteRequest({
    srcChain: "base",
    dstChain: "optimism",
    ticker: "usdc",
    amount: "100000000",
  });
  const responseBody = {
    totalRelayFee: { pct: "15000000000000000" }, // 1.5%
    outputAmount: "98500000",
    timestamp: 1_714_000_000,
  };
  assert.throws(
    () => normalizeAcrossQuote({ request, responseBody, now: 1_714_000_000 }),
    /relayer fee .* exceeds cap/,
  );
});

test("normalizeAcrossQuote rejects zero output amount", () => {
  const request = buildAcrossQuoteRequest({
    srcChain: "base",
    dstChain: "optimism",
    ticker: "usdc",
    amount: "100000000",
  });
  const responseBody = {
    totalRelayFee: { pct: "1000000000000000" },
    outputAmount: "0",
    timestamp: 1_714_000_000,
  };
  assert.throws(() => normalizeAcrossQuote({ request, responseBody, now: 1_714_000_000 }), /zero output/);
});

test("acrossSpokePool resolves known chains and returns null for unknown", () => {
  assert.ok(acrossSpokePool("base"));
  assert.ok(acrossSpokePool("optimism"));
  assert.equal(acrossSpokePool("bob"), null);
});
