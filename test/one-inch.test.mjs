import assert from "node:assert/strict";
import { test } from "node:test";
import { OneInchProvider } from "../src/dex/providers/one-inch.mjs";
import { ONE_INCH_API_BASE, ONE_INCH_CHAIN_IDS, ONE_INCH_SWAP_VERSION } from "../src/config/dex-providers.mjs";

const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const NATIVE_MARKER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

test("OneInchProvider has correct name", () => {
  const provider = new OneInchProvider();
  assert.equal(provider.name, "one_inch");
});

test("OneInchProvider supports BSC", () => {
  const provider = new OneInchProvider();
  assert.equal(provider.supportsChain("bsc"), true);
  assert.equal(provider.supportsChain("base"), false);
});

test("OneInchProvider chain IDs are correct", () => {
  assert.equal(ONE_INCH_CHAIN_IDS.bsc, 56);
});

test("OneInchProvider quote fails without API key", async () => {
  // Clear any existing API key
  const originalKey = process.env.BOB_CLAW_INCH_API_KEY;
  delete process.env.BOB_CLAW_INCH_API_KEY;

  const provider = new OneInchProvider();
  try {
    await provider.quote({
      chain: "bsc",
      inputToken: BSC_USDT,
      outputToken: NATIVE_MARKER,
      amount: "1000000000000000000",
    });
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error.message.includes("API key not configured"));
    assert.equal(error.provider, "one_inch");
  }

  // Restore
  if (originalKey !== undefined) process.env.BOB_CLAW_INCH_API_KEY = originalKey;
});

test("OneInchProvider quote constructs correct URL", async () => {
  process.env.BOB_CLAW_INCH_API_KEY = "test-key-123";
  let fetchedUrl = null;
  let fetchedHeaders = null;

  const provider = new OneInchProvider();
  // Mock fetch
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    fetchedUrl = url;
    fetchedHeaders = options?.headers;
    return {
      ok: true,
      json: async () => ({
        dstAmount: "5000000000000000000",
        gas: 200000,
      }),
    };
  };

  try {
    await provider.quote({
      chain: "bsc",
      inputToken: BSC_USDT,
      outputToken: NATIVE_MARKER,
      amount: "1000000000000000000",
    });

    assert.ok(fetchedUrl.includes("/swap/v6.1/56/quote"));
    assert.ok(fetchedUrl.includes(`src=${BSC_USDT}`));
    assert.ok(fetchedUrl.includes(`dst=${NATIVE_MARKER}`));
    assert.ok(fetchedUrl.includes("amount=1000000000000000000"));
    assert.equal(fetchedHeaders?.Authorization, "Bearer test-key-123");
  } finally {
    global.fetch = originalFetch;
    delete process.env.BOB_CLAW_INCH_API_KEY;
  }
});

test("OneInchProvider quote returns normalized quote object", async () => {
  process.env.BOB_CLAW_INCH_API_KEY = "test-key";
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      dstAmount: "5000000000000000000",
      gas: 200000,
    }),
  });

  try {
    const provider = new OneInchProvider();
    const quote = await provider.quote({
      chain: "bsc",
      inputToken: BSC_USDT,
      outputToken: NATIVE_MARKER,
      amount: "1000000000000000000",
      slippageBps: 50,
    });

    assert.equal(quote.provider, "one_inch");
    assert.equal(quote.chain, "bsc");
    assert.equal(quote.chainId, 56);
    assert.equal(quote.outputAmount, "5000000000000000000");
    assert.equal(quote.slippageBps, 50);
    assert.equal(quote.routingMode, "api_routed");
    assert.equal(quote.executionTrust, "api_routed");
  } finally {
    global.fetch = originalFetch;
    delete process.env.BOB_CLAW_INCH_API_KEY;
  }
});

test("OneInchProvider assemble constructs correct swap URL", async () => {
  process.env.BOB_CLAW_INCH_API_KEY = "test-key";
  let fetchedUrl = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    fetchedUrl = url;
    return {
      ok: true,
      json: async () => ({
        tx: {
          to: "0x1111111111111111111111111111111111111111",
          data: "0xdeadbeef",
          value: "0",
          gas: 250000,
          gasPrice: "3000000000",
        },
      }),
    };
  };

  try {
    const provider = new OneInchProvider();
    const quote = {
      chain: "bsc",
      chainId: 56,
      inputToken: BSC_USDT,
      outputToken: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      inputAmount: "1000000000000000000",
      outputAmount: "5000000000000000000",
      slippageBps: 50,
      pathId: "one_inch:abc:def:1000",
      provider: "one_inch",
    };

    const result = await provider.assemble({
      quote,
      senderAddress: "0x1234567890123456789012345678901234567890",
    });

    assert.ok(fetchedUrl.includes("/swap/v6.1/56/swap"));
    assert.ok(fetchedUrl.includes("from=0x1234567890123456789012345678901234567890"));
    assert.ok(fetchedUrl.includes("slippage=0.5"));
    assert.equal(result.txTo, "0x1111111111111111111111111111111111111111");
    assert.equal(result.txData, "0xdeadbeef");
    assert.equal(result.txGasLimit, 250000);
    assert.equal(result.gasPrice, "3000000000");
  } finally {
    global.fetch = originalFetch;
    delete process.env.BOB_CLAW_INCH_API_KEY;
  }
});

test("OneInchProvider quote handles API errors", async () => {
  process.env.BOB_CLAW_INCH_API_KEY = "test-key";
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 429,
    text: async () => "Rate limited",
  });

  try {
    const provider = new OneInchProvider();
    try {
      await provider.quote({
        chain: "bsc",
        inputToken: BSC_USDT,
        outputToken: NATIVE_MARKER,
        amount: "1000000000000000000",
      });
      assert.fail("Should have thrown");
    } catch (error) {
      assert.equal(error.status, 429);
      assert.equal(error.provider, "one_inch");
    }
  } finally {
    global.fetch = originalFetch;
    delete process.env.BOB_CLAW_INCH_API_KEY;
  }
});