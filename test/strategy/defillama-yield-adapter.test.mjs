import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateDefiLlamaYieldAdapter,
  buildDefaultDefiLlamaYieldConfig,
  validateDefiLlamaYieldConfig,
  summarizeDefiLlamaYieldAdapter,
} from "../../src/strategy/defillama-yield-adapter.mjs";

test("default config validates", () => {
  const config = buildDefaultDefiLlamaYieldConfig();
  const v = validateDefiLlamaYieldConfig(config);
  assert.equal(v.ok, true);
  assert.equal(v.missingFields.length, 0);
});

test("adapter blocked when no pools measured", () => {
  const report = evaluateDefiLlamaYieldAdapter({
    config: buildDefaultDefiLlamaYieldConfig(),
    market: {},
    receipts: [],
  });
  assert.equal(report.mode, "blocked");
  assert.ok(report.blockers.includes("no_pools_measured"));
  assert.equal(report.shadowReady, false);
});

test("adapter blocked when pools do not pass policy", () => {
  const report = evaluateDefiLlamaYieldAdapter({
    config: buildDefaultDefiLlamaYieldConfig(),
    market: {
      pools: [
        {
          chain: "base",
          family: "stablecoin",
          tvlUsd: 10_000,
          apyBps: 50,
          entrySlippageBps: 10,
          exitSlippageBps: 10,
          gatewayRoundTripCostBps: 50,
          offrampCostBps: 30,
        },
      ],
    },
    receipts: [],
  });
  assert.equal(report.mode, "blocked");
  assert.ok(report.blockers.includes("no_pool_passes_policy"));
  assert.equal(report.shadowReady, false);
});

test("adapter shadow_ready when best pool passes policy", () => {
  const report = evaluateDefiLlamaYieldAdapter({
    config: { ...buildDefaultDefiLlamaYieldConfig(), perTradeCapUsd: 25 },
    market: {
      pools: [
        {
          chain: "base",
          family: "stablecoin",
          protocol: "aave-v3",
          poolId: "aave-base-usdc",
          symbol: "USDC",
          tvlUsd: 2_000_000,
          apyBps: 2000,
          entrySlippageBps: 5,
          exitSlippageBps: 5,
          gatewayRoundTripCostBps: 20,
          offrampCostBps: 10,
        },
        {
          chain: "ethereum",
          family: "wrapped_btc",
          protocol: "compound",
          poolId: "compound-eth-wbtc",
          symbol: "WBTC",
          tvlUsd: 1_000_000,
          apyBps: 200,
          entrySlippageBps: 20,
          exitSlippageBps: 20,
          gatewayRoundTripCostBps: 80,
          offrampCostBps: 40,
        },
      ],
    },
    receipts: [],
  });
  assert.equal(report.mode, "shadow_ready");
  assert.equal(report.shadowReady, true);
  assert.equal(report.liveReady, false);
  assert.equal(report.market.bestPool.chain, "base");
  assert.equal(report.market.bestPool.protocol, "aave-v3");
  assert.equal(report.economics.projectedNetUsd > 0, true);
  assert.equal(report.intent.strategyId, "defillama-yield-portfolio");
  assert.equal(report.intent.chain, "base");
});

test("adapter live_ready when receipts prove entry/exit", () => {
  const report = evaluateDefiLlamaYieldAdapter({
    config: { ...buildDefaultDefiLlamaYieldConfig(), perTradeCapUsd: 25 },
    market: {
      pools: [
        {
          chain: "base",
          family: "stablecoin",
          protocol: "aave-v3",
          poolId: "aave-base-usdc",
          symbol: "USDC",
          tvlUsd: 2_000_000,
          apyBps: 2000,
          entrySlippageBps: 5,
          exitSlippageBps: 5,
          gatewayRoundTripCostBps: 20,
          offrampCostBps: 10,
        },
      ],
    },
    receipts: [
      { signerBacked: true, result: "passed", realizedNetUsd: 5, entryExitProven: true },
    ],
  });
  assert.equal(report.mode, "live_candidate");
  assert.equal(report.liveReady, true);
});

test("summary returns key metrics", () => {
  const report = evaluateDefiLlamaYieldAdapter({
    config: { ...buildDefaultDefiLlamaYieldConfig(), perTradeCapUsd: 25 },
    market: {
      pools: [
        {
          chain: "base",
          family: "stablecoin",
          protocol: "aave-v3",
          poolId: "aave-base-usdc",
          symbol: "USDC",
          tvlUsd: 2_000_000,
          apyBps: 2000,
          entrySlippageBps: 5,
          exitSlippageBps: 5,
          gatewayRoundTripCostBps: 20,
          offrampCostBps: 10,
        },
      ],
    },
    receipts: [],
  });
  const summary = summarizeDefiLlamaYieldAdapter(report);
  assert.equal(summary.strategyId, "defillama-yield-portfolio");
  assert.equal(summary.promotion, "shadow_ready");
  assert.equal(summary.blockerCount, 0);
  assert.equal(summary.projectedNetUsd > 0, true);
  assert.equal(summary.bestPoolChain, "base");
  assert.equal(summary.bestPoolProtocol, "aave-v3");
});

test("unsupported chain and family are filtered", () => {
  const report = evaluateDefiLlamaYieldAdapter({
    config: buildDefaultDefiLlamaYieldConfig(),
    market: {
      pools: [
        {
          chain: "arbitrum",
          family: "meme",
          tvlUsd: 5_000_000,
          apyBps: 2000,
          entrySlippageBps: 10,
          exitSlippageBps: 10,
          gatewayRoundTripCostBps: 50,
          offrampCostBps: 30,
        },
      ],
    },
    receipts: [],
  });
  assert.equal(report.mode, "blocked");
  assert.equal(report.shadowReady, false);
});
