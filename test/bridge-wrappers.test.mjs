import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchAcrossQuote, buildAcrossRouteIntent } from "../src/executor/bridges/across-wrapper.mjs";
import { fetchLiFiQuote, buildLiFiRouteIntent } from "../src/executor/bridges/lifi-wrapper.mjs";
import { fetchNativeBtcTunnelQuote, buildNativeBtcTunnelIntent } from "../src/executor/bridges/native-btc-tunnel-wrapper.mjs";

function mockFetch(responseBody, status = 200, delayMs = 0) {
  return async (_url, { signal } = {}) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({
          ok: status >= 200 && status < 300,
          status,
          json: async () => responseBody,
        });
      }, delayMs);
      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          const err = new Error("AbortError");
          err.name = "AbortError";
          reject(err);
        });
      }
    });
  };
}

function mockFetchReject(error) {
  return async () => { throw error; };
}

test("across unsupported pair returns error", async () => {
  const result = await fetchAcrossQuote({
    srcChain: "fantasy",
    dstChain: "base",
    tokenTicker: "usdc",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "across_unsupported_pair");
});

test("across fetch success returns quote", async () => {
  const result = await fetchAcrossQuote({
    srcChain: "base",
    dstChain: "optimism",
    tokenTicker: "usdc",
    amount: "1000000",
    srcChainId: 8453,
    dstChainId: 10,
  }, { fetchFn: mockFetch({ totalRelayFee: { pct: 0.0004, total: "400" }, estimatedFillTimeSec: 120 }) });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "across");
  assert.equal(result.feePct, 0.0004);
  assert.equal(result.feeAmount, 400);
  assert.equal(result.estimatedTimeMs, 120_000);
});

test("across http error returns error", async () => {
  const result = await fetchAcrossQuote({
    srcChain: "base",
    dstChain: "optimism",
    tokenTicker: "usdc",
    amount: "1000000",
    srcChainId: 8453,
    dstChainId: 10,
  }, { fetchFn: mockFetch({}, 500) });
  assert.equal(result.ok, false);
  assert.equal(result.error, "across_http_500");
});

test("across timeout returns timeout error", async () => {
  const result = await fetchAcrossQuote({
    srcChain: "base",
    dstChain: "optimism",
    tokenTicker: "usdc",
    amount: "1000000",
    srcChainId: 8453,
    dstChainId: 10,
  }, { fetchFn: mockFetch({}, 200, 100), timeoutMs: 10 });
  assert.equal(result.ok, false);
  assert.equal(result.error, "across_timeout");
});

test("across build intent returns structured intent", () => {
  const intent = buildAcrossRouteIntent(
    { ok: true, feeAmount: 400, feePct: 0.0004, estimatedTimeMs: 120_000, validUntil: 1 },
    { srcChain: "base", dstChain: "optimism", tokenTicker: "usdc", amount: "1000000" }
  );
  assert.equal(intent.provider, "across");
  assert.equal(intent.feeAmount, 400);
});

test("across build intent returns null on failed quote", () => {
  const intent = buildAcrossRouteIntent({ ok: false }, {});
  assert.equal(intent, null);
});

test("lifi missing params returns error", async () => {
  const result = await fetchLiFiQuote({ srcChain: "base" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "lifi_missing_required_params");
});

test("lifi fetch success returns quote", async () => {
  const result = await fetchLiFiQuote({
    srcChain: "base",
    dstChain: "optimism",
    srcToken: "0xUSDC",
    dstToken: "0xUSDC",
    amount: "1000000",
  }, { fetchFn: mockFetch({ estimate: { toAmount: "990000", toAmountMin: "985000", executionDuration: 240, feeCosts: [{ amountUsd: "2.5" }] } }) });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "lifi");
  assert.equal(result.toAmount, 990000);
  assert.equal(result.feeUsd, 2.5);
});

test("lifi timeout returns timeout error", async () => {
  const result = await fetchLiFiQuote({
    srcChain: "base",
    dstChain: "optimism",
    srcToken: "0xUSDC",
    dstToken: "0xUSDC",
    amount: "1000000",
  }, { fetchFn: mockFetch({}, 200, 100), timeoutMs: 10 });
  assert.equal(result.ok, false);
  assert.equal(result.error, "lifi_timeout");
});

test("lifi build intent returns structured intent", () => {
  const intent = buildLiFiRouteIntent(
    { ok: true, feeUsd: 2.5, toAmount: 990000, estimatedTimeMs: 240_000, validUntil: 1 },
    { srcChain: "base", dstChain: "optimism", srcToken: "0xUSDC", dstToken: "0xUSDC", amount: "1000000" }
  );
  assert.equal(intent.provider, "lifi");
  assert.equal(intent.toAmount, 990000);
});

test("native btc tunnel unsupported chain returns error", async () => {
  const result = await fetchNativeBtcTunnelQuote({
    chain: "base",
    amountSats: 10000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "native_btc_tunnel_unsupported_chain");
});

test("native btc tunnel fetch success returns quote", async () => {
  const result = await fetchNativeBtcTunnelQuote({
    chain: "bob",
    amountSats: 10000,
    recipientBtcAddress: "bc1q...",
  }, {
    fetchFn: mockFetch({ feeSats: 500, estimatedTimeMs: 300_000 }),
    chainConfig: { nativeBtcBridge: { endpoint: "https://bridge.example.com" } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "native_btc_tunnel");
  assert.equal(result.feeSats, 500);
});

test("native btc tunnel timeout returns timeout error", async () => {
  const result = await fetchNativeBtcTunnelQuote({
    chain: "bob",
    amountSats: 10000,
  }, {
    fetchFn: mockFetch({}, 200, 100),
    timeoutMs: 10,
    chainConfig: { nativeBtcBridge: { endpoint: "https://bridge.example.com" } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "native_btc_tunnel_timeout");
});

test("native btc tunnel build intent returns structured intent", () => {
  const intent = buildNativeBtcTunnelIntent(
    { ok: true, feeSats: 500, estimatedTimeMs: 300_000, validUntil: 1 },
    { chain: "bob", amountSats: 10000, recipientBtcAddress: "bc1q..." }
  );
  assert.equal(intent.provider, "native_btc_tunnel");
  assert.equal(intent.feeSats, 500);
});
