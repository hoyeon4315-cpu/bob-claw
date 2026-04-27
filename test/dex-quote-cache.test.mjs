import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DexQuoteCache, dexQuoteAmountBucket } from "../src/executor/discovery/dex-quote-cache.mjs";
import { quoteForLive, quoteForProbe } from "../src/dex/providers.mjs";

function cachePath(name) {
  const fileUrl = new URL(`../data/cache/${name}`, import.meta.url);
  return {
    fileUrl,
    path: fileURLToPath(fileUrl),
  };
}

async function cleanup(target) {
  await rm(target.path, { force: true });
}

function fakeProvider(callState) {
  return {
    name: "fake_probe_dex",
    supportsChain: () => true,
    async quote(params) {
      callState.quoteCount += 1;
      return {
        chain: params.chain,
        inputToken: params.inputToken,
        outputToken: params.outputToken,
        inputAmount: params.amount,
        outputAmount: String(1000 + callState.quoteCount),
        pathId: `path-${callState.quoteCount}`,
      };
    },
    async assemble({ quote }) {
      callState.assembleCount += 1;
      return {
        ...quote,
        txTo: "0x1111111111111111111111111111111111111111",
        txData: "0xabcdef",
        txValueWei: "0",
      };
    },
  };
}

test("dexQuoteAmountBucket rounds log10(amount)", () => {
  assert.equal(dexQuoteAmountBucket("9"), 1);
  assert.equal(dexQuoteAmountBucket("10"), 1);
  assert.equal(dexQuoteAmountBucket("499"), 3);
  assert.equal(dexQuoteAmountBucket("1000000000000000000"), 18);
});

test("quoteForProbe caches first miss and serves later hit", async () => {
  const pathUrl = cachePath("dex-quote-cache-miss-hit.json");
  await cleanup(pathUrl);
  const cache = new DexQuoteCache({ cachePath: pathUrl.path, ttlMs: 30_000 });
  const callState = { quoteCount: 0, assembleCount: 0 };
  const provider = fakeProvider(callState);
  const params = {
    chain: "base",
    inputToken: "0xaaaa",
    outputToken: "0xbbbb",
    amount: "1000000",
    senderAddress: "0x1234",
    slippageBps: 50,
  };

  try {
    const first = await quoteForProbe([provider], params, {
      cache,
      routeKey: "route-alpha",
      srcChain: "base",
      now: "2026-04-27T00:00:00.000Z",
    });
    const second = await quoteForProbe([provider], params, {
      cache,
      routeKey: "route-alpha",
      srcChain: "base",
      now: "2026-04-27T00:00:10.000Z",
    });

    assert.equal(first.cache.hit, false);
    assert.equal(second.cache.hit, true);
    assert.equal(callState.quoteCount, 1);
    assert.equal(callState.assembleCount, 1);
    assert.equal(second.executableQuote.outputAmount, first.executableQuote.outputAmount);
  } finally {
    await cleanup(pathUrl);
  }
});

test("quoteForProbe expires stale entries and requotes", async () => {
  const pathUrl = cachePath("dex-quote-cache-expiry.json");
  await cleanup(pathUrl);
  const cache = new DexQuoteCache({ cachePath: pathUrl.path, ttlMs: 1_000 });
  const callState = { quoteCount: 0, assembleCount: 0 };
  const provider = fakeProvider(callState);
  const params = {
    chain: "base",
    inputToken: "0xaaaa",
    outputToken: "0xbbbb",
    amount: "1000000",
    senderAddress: "0x1234",
    slippageBps: 50,
  };

  try {
    const first = await quoteForProbe([provider], params, {
      cache,
      routeKey: "route-beta",
      srcChain: "base",
      now: "2026-04-27T00:00:00.000Z",
    });
    const second = await quoteForProbe([provider], params, {
      cache,
      routeKey: "route-beta",
      srcChain: "base",
      now: "2026-04-27T00:00:02.000Z",
    });

    assert.equal(first.cache.hit, false);
    assert.equal(second.cache.hit, false);
    assert.equal(callState.quoteCount, 2);
    assert.notEqual(second.executableQuote.outputAmount, first.executableQuote.outputAmount);
  } finally {
    await cleanup(pathUrl);
  }
});

test("DexQuoteCache rehydrates cached file after restart", async () => {
  const pathUrl = cachePath("dex-quote-cache-rehydrate.json");
  await cleanup(pathUrl);
  const callState = { quoteCount: 0, assembleCount: 0 };
  const provider = fakeProvider(callState);
  const params = {
    chain: "base",
    inputToken: "0xaaaa",
    outputToken: "0xbbbb",
    amount: "1000000",
    senderAddress: "0x1234",
    slippageBps: 50,
  };

  try {
    const firstCache = new DexQuoteCache({ cachePath: pathUrl.path, ttlMs: 30_000 });
    await quoteForProbe([provider], params, {
      cache: firstCache,
      routeKey: "route-gamma",
      srcChain: "base",
      now: "2026-04-27T00:00:00.000Z",
    });

    const restartedCache = new DexQuoteCache({ cachePath: pathUrl.path, ttlMs: 30_000 });
    const second = await quoteForProbe([provider], params, {
      cache: restartedCache,
      routeKey: "route-gamma",
      srcChain: "base",
      now: "2026-04-27T00:00:05.000Z",
    });

    assert.equal(second.cache.hit, true);
    assert.equal(callState.quoteCount, 1);
    assert.equal(callState.assembleCount, 1);
  } finally {
    await cleanup(pathUrl);
  }
});

test("quoteForLive bypasses probe cache", async () => {
  const pathUrl = cachePath("dex-quote-cache-live-bypass.json");
  await cleanup(pathUrl);
  const cache = new DexQuoteCache({ cachePath: pathUrl.path, ttlMs: 30_000 });
  const callState = { quoteCount: 0, assembleCount: 0 };
  const provider = fakeProvider(callState);
  const params = {
    chain: "base",
    inputToken: "0xaaaa",
    outputToken: "0xbbbb",
    amount: "1000000",
    senderAddress: "0x1234",
    slippageBps: 50,
  };

  try {
    await quoteForProbe([provider], params, {
      cache,
      routeKey: "route-delta",
      srcChain: "base",
      now: "2026-04-27T00:00:00.000Z",
    });
    const live = await quoteForLive([provider], params);

    assert.equal(callState.quoteCount, 2);
    assert.equal(callState.assembleCount, 2);
    assert.equal(live.executableQuote.outputAmount, "1002");
    assert.equal("cache" in live, false);
  } finally {
    await cleanup(pathUrl);
  }
});
