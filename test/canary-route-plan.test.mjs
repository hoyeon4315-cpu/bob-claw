import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCanaryRoutePlan } from "../src/estimator/canary-route-plan.mjs";

const ADDRESS = "0x000000000000000000000000000000000000dEaD";
const WBTC_OFT = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

function quote({ routeKey, srcChain, dstChain, amount = "10000", txData = "0x1234", txTo = WBTC_OFT, quoteType = "layerZero" }) {
  return {
    routeKey,
    amount,
    quoteType,
    txData,
    txTo,
    route: { srcChain, dstChain, srcToken: WBTC_OFT, dstToken: WBTC_OFT },
  };
}

function score({ routeKey, amount = "10000", srcChain = "bob", dstChain = "base", dataGaps = [], inputUsd = 7.3, srcRawUsd = 73000 }) {
  return {
    routeKey,
    amount,
    srcChain,
    dstChain,
    srcAsset: { ticker: "wBTC.OFT", decimals: 8 },
    price: { srcRawUsd },
    inputUsd,
    netEdgeUsd: -0.3,
    executableNetEdgeUsd: null,
    dataGaps,
    tradeReadiness: "insufficient_data",
    executionGasSource: null,
  };
}

test("canary route plan prioritizes tx-ready route with lowest prep funding", () => {
  const plan = buildCanaryRoutePlan(
    {
      quotes: [
        quote({ routeKey: `bob:${WBTC_OFT}->base:${WBTC_OFT}`, srcChain: "bob", dstChain: "base" }),
        quote({ routeKey: `bob:${WBTC_OFT}->ethereum:${WBTC_OFT}`, srcChain: "bob", dstChain: "ethereum" }),
      ],
      scores: [
        score({ routeKey: `bob:${WBTC_OFT}->base:${WBTC_OFT}` }),
        score({ routeKey: `bob:${WBTC_OFT}->ethereum:${WBTC_OFT}`, inputUsd: 18.2 }),
      ],
      readinessRecords: [
        {
          observedAt: "2026-04-11T01:00:00.000Z",
          address: ADDRESS,
          routeKey: `bob:${WBTC_OFT}->base:${WBTC_OFT}`,
          amount: "10000",
          srcChain: "bob",
          dstChain: "base",
          native: { shortfallWei: "100000000000000", ok: false },
          token: { shortfall: "10000", ok: false },
          allowance: { shortfall: "10000", ok: false },
        },
        {
          observedAt: "2026-04-11T01:01:00.000Z",
          address: ADDRESS,
          routeKey: `bob:${WBTC_OFT}->ethereum:${WBTC_OFT}`,
          amount: "10000",
          srcChain: "bob",
          dstChain: "ethereum",
          native: { shortfallWei: "200000000000000", ok: false },
          token: { shortfall: "20000", ok: false },
          allowance: { shortfall: "20000", ok: false },
        },
      ],
      readinessFailures: [],
    },
    {
      address: ADDRESS,
      prices: { nativeByChain: { bob: 1800 } },
    },
  );

  assert.equal(plan.candidateCount, 2);
  assert.equal(plan.viableCount, 2);
  assert.equal(plan.topCandidates[0].dstChain, "base");
  assert.equal(plan.topCandidates[0].prepFundingUsd < plan.topCandidates[1].prepFundingUsd, true);
});

test("canary route plan blocks missing tx data and score outliers", () => {
  const plan = buildCanaryRoutePlan(
    {
      quotes: [
        quote({ routeKey: `bob:${WBTC_OFT}->base:${WBTC_OFT}`, srcChain: "bob", dstChain: "base", txData: null }),
        quote({ routeKey: `bob:${WBTC_OFT}->sonic:${WBTC_OFT}`, srcChain: "bob", dstChain: "sonic" }),
      ],
      scores: [
        score({ routeKey: `bob:${WBTC_OFT}->base:${WBTC_OFT}` }),
        score({ routeKey: `bob:${WBTC_OFT}->sonic:${WBTC_OFT}`, dstChain: "sonic", dataGaps: ["implausible_quote_value_ratio"] }),
      ],
      readinessRecords: [],
      readinessFailures: [
        {
          observedAt: "2026-04-11T01:02:00.000Z",
          address: ADDRESS,
          routeKey: `bob:${WBTC_OFT}->base:${WBTC_OFT}`,
          amount: "10000",
          reason: "missing_tx_data",
        },
      ],
    },
    { address: ADDRESS, prices: { nativeByChain: { bob: 1800 } } },
  );

  assert.equal(plan.viableCount, 0);
  assert.equal(plan.topCandidates[0].txReady, true);
  assert.deepEqual(plan.topCandidates[0].scoreDisqualifiers, ["implausible_quote_value_ratio"]);
  assert.equal(plan.topCandidates[1].readinessFailureReason, "missing_tx_data");
});
