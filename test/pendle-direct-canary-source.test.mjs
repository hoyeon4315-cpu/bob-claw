import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPendleDirectCanaryCandidate,
  buildPendleDirectCanaryFeed,
  pendleDirectCandidateToOpportunity,
} from "../src/strategy/pendle-direct-canary-source.mjs";
import { TOKEN_REGISTRY } from "../src/config/token-registry.mjs";
import { tokenAsset } from "../src/assets/tokens.mjs";
import { buildMerklCanaryQueue } from "../src/strategy/merkl-canary-queue.mjs";

const FAR_FUTURE = "2099-12-25T00:00:00.000Z";
const NOW = new Date("2026-05-11T00:00:00Z").getTime();

const STABLE_MARKET = {
  name: "apxUSD",
  address: "0x250c15e59a7572195e248f668636723cca20a2b8",
  expiry: FAR_FUTURE,
  pt: "8453-0xaaa0000000000000000000000000000000000001",
  yt: "8453-0xbbb0000000000000000000000000000000000002",
  underlyingAsset: "8453-0xd993935e13851dd7517af10687ec7e5022127228",
  details: { totalTvl: 6_348_426.2, impliedApy: 0.1521 },
};

const BTC_MARKET = {
  name: "uniBTC",
  address: "0x483f2e223c58a5ef19c4b32fbc2de57709749cb1",
  expiry: FAR_FUTURE,
  pt: "8453-0xaaa0000000000000000000000000000000000004",
  yt: "8453-0xbbb0000000000000000000000000000000000005",
  underlyingAsset: "8453-0xccc0000000000000000000000000000000000006",
  details: { totalTvl: 2_159_691.1, impliedApy: 0.0103 },
};

const MATURED_MARKET = {
  ...STABLE_MARKET,
  expiry: "2020-01-01T00:00:00.000Z",
};

test("buildPendleDirectCanaryCandidate classifies stable family", () => {
  const c = buildPendleDirectCanaryCandidate(STABLE_MARKET, { chainId: 8453, now: NOW });
  assert.equal(c.protocolId, "pendle");
  assert.equal(c.executionSurface, "fixedYield");
  assert.equal(c.family, "stable_fixed_yield");
  assert.equal(c.chain, "base");
  assert.equal(c.tvlUsd, 6_348_426.2);
  assert.equal(Math.round(c.aprPct * 100) / 100, 15.21);
  assert.equal(c.protocolBinding.instrument, "yt");
  assert.equal(c.opportunityId, "pendle-direct:8453:0x250c15e59a7572195e248f668636723cca20a2b8");
});

test("buildPendleDirectCanaryCandidate classifies BTC family", () => {
  const c = buildPendleDirectCanaryCandidate(BTC_MARKET, { chainId: 8453, now: NOW });
  assert.equal(c.family, "btc_fixed_yield");
});

test("buildPendleDirectCanaryCandidate rejects matured market", () => {
  const c = buildPendleDirectCanaryCandidate(MATURED_MARKET, { chainId: 8453, now: NOW });
  assert.equal(c, null);
});

test("buildPendleDirectCanaryFeed applies family TVL floor", () => {
  const feed = buildPendleDirectCanaryFeed({
    snapshotsByChainId: { 8453: { markets: [STABLE_MARKET, BTC_MARKET] } },
    now: NOW,
    minTvlByFamily: { stable_fixed_yield: 5_000_000, btc_fixed_yield: 3_000_000 },
  });
  assert.equal(feed.length, 1);
  assert.equal(feed[0].family, "stable_fixed_yield");
});

test("buildPendleDirectCanaryFeed sorts by TVL desc", () => {
  const feed = buildPendleDirectCanaryFeed({
    snapshotsByChainId: { 8453: { markets: [BTC_MARKET, STABLE_MARKET] } },
    now: NOW,
  });
  assert.equal(feed.length, 2);
  assert.equal(feed[0].assetSymbol, "apxUSD");
  assert.equal(feed[1].assetSymbol, "uniBTC");
});

test("apxUSD registry entry points at the underlying ERC20, not the Pendle market", () => {
  const token = TOKEN_REGISTRY.base.find((item) => item.symbol === "apxUSD");
  assert.equal(token?.address, STABLE_MARKET.underlyingAsset.split("-")[1]);
  assert.equal(tokenAsset("base", token.address).priceKey, "usd_stable");
});

test("apxUSD direct Pendle candidate can pass auto-entry once inventory exists", () => {
  const candidate = buildPendleDirectCanaryCandidate(STABLE_MARKET, { chainId: 8453, now: NOW });
  const opportunity = pendleDirectCandidateToOpportunity(candidate, { now: NOW });
  const queue = buildMerklCanaryQueue({
    report: { opportunities: [opportunity] },
    operatingCapitalUsd: 500,
    inventorySnapshot: {
      tokens: [
        {
          chain: "base",
          ticker: "apxUSD",
          token: STABLE_MARKET.underlyingAsset.split("-")[1],
          actual: "10000000000000000000",
          actualDecimal: 10,
          estimatedUsd: 10,
          status: "ready",
        },
      ],
      native: [
        {
          chain: "base",
          asset: "ETH",
          actual: "1000000000000000",
          actualDecimal: 0.001,
          estimatedUsd: 2,
          status: "ready",
        },
      ],
    },
    now: new Date(NOW).toISOString(),
  });

  assert.equal(queue.queue.length, 1);
  assert.deepEqual(queue.queue[0].entryAssets, ["apxUSD"]);
  assert.equal(queue.queue[0].executionReadiness.status, "inventory_ready");
  assert.equal(queue.queue[0].autoEntry.autoExecute, true);
  assert.deepEqual(queue.queue[0].autoEntry.blockers, []);
});

test("apxUSD direct Pendle candidate can use Hosted SDK zap token inventory", () => {
  const candidate = buildPendleDirectCanaryCandidate(
    {
      ...STABLE_MARKET,
      sdkMarketTokens: {
        tokensIn: [STABLE_MARKET.underlyingAsset.split("-")[1], "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"],
      },
    },
    { chainId: 8453, now: NOW },
  );
  const opportunity = pendleDirectCandidateToOpportunity(candidate, { now: NOW });
  const queue = buildMerklCanaryQueue({
    report: { opportunities: [opportunity] },
    operatingCapitalUsd: 500,
    inventorySnapshot: {
      tokens: [
        {
          chain: "base",
          ticker: "USDC",
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          actual: "10000000",
          actualDecimal: 10,
          estimatedUsd: 10,
          status: "ready",
        },
      ],
      native: [
        {
          chain: "base",
          asset: "ETH",
          actual: "1000000000000000",
          actualDecimal: 0.001,
          estimatedUsd: 2,
          status: "ready",
        },
      ],
    },
    now: new Date(NOW).toISOString(),
  });

  assert.equal(queue.queue.length, 1);
  assert.equal(queue.queue[0].executionReadiness.status, "inventory_ready");
  assert.equal(queue.queue[0].executionReadiness.matchedToken.ticker, "USDC");
  assert.equal(queue.queue[0].autoEntry.autoExecute, true);
});
