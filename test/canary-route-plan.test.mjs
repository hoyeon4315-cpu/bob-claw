import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCanaryRoutePlan } from "../src/estimator/canary-route-plan.mjs";
import { ETHEREUM_L1_PHASE_DISABLED_REASON } from "../src/risk/ethereum-l1-policy.mjs";

const ADDRESS = "0x000000000000000000000000000000000000dEaD";
const WBTC_OFT = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

function quote({
  routeKey,
  srcChain,
  dstChain,
  amount = "10000",
  txData = "0x1234",
  txTo = WBTC_OFT,
  quoteType = "layerZero",
  inputAmount = amount,
  txValueWei = "0",
}) {
  return {
    routeKey,
    amount,
    quoteType,
    txData,
    txTo,
    inputAmount,
    txValueWei,
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

test("canary route plan marks Ethereum L1 scores as disqualified for prep", () => {
  const ethRouteKey = `base:${WBTC_OFT}->ethereum:${WBTC_OFT}`;
  const plan = buildCanaryRoutePlan(
    {
      quotes: [
        quote({ routeKey: `bob:${WBTC_OFT}->base:${WBTC_OFT}`, srcChain: "bob", dstChain: "base" }),
        quote({ routeKey: ethRouteKey, srcChain: "base", dstChain: "ethereum" }),
      ],
      scores: [
        score({ routeKey: `bob:${WBTC_OFT}->base:${WBTC_OFT}` }),
        {
          ...score({ routeKey: ethRouteKey, srcChain: "base", dstChain: "ethereum" }),
          tradeReadiness: ETHEREUM_L1_PHASE_DISABLED_REASON,
        },
      ],
      readinessRecords: [],
      readinessFailures: [],
    },
    { address: ADDRESS, prices: { nativeByChain: { base: 1800, bob: 1800 } } },
  );

  assert.equal(plan.viableCount, 1);
  assert.equal(plan.topCandidates[1].viableForPrep, false);
  assert.equal(plan.topCandidates[1].scoreDisqualifiers.includes(ETHEREUM_L1_PHASE_DISABLED_REASON), true);
});

test("canary route plan infers token blockers from latest known balances for unchecked amounts", () => {
  const routeKey = `base:${WBTC_OFT}->ethereum:${WBTC_OFT}`;
  const plan = buildCanaryRoutePlan(
    {
      quotes: [
        quote({
          routeKey,
          srcChain: "base",
          dstChain: "ethereum",
          amount: "25000",
          inputAmount: "25000",
          txValueWei: "1000",
        }),
      ],
      scores: [
        score({ routeKey, amount: "25000", srcChain: "base", dstChain: "ethereum" }),
      ],
      readinessRecords: [
        {
          observedAt: "2026-04-11T01:05:00.000Z",
          address: ADDRESS,
          routeKey,
          amount: "10000",
          srcChain: "base",
          dstChain: "ethereum",
          native: { balanceWei: "999999999999999999", requiredWei: "1000", shortfallWei: "0", ok: true },
          token: { token: WBTC_OFT, balance: "10000", required: "10000", shortfall: "0", ok: true },
          allowance: null,
          overallReady: true,
        },
      ],
      readinessFailures: [],
    },
    { address: ADDRESS, prices: { nativeByChain: { base: 1800 } } },
  );

  assert.deepEqual(plan.topCandidates[0].prepBlockers, ["token"]);
  assert.equal(plan.topCandidates[0].readinessFailureReason, null);
  assert.equal(plan.topCandidates[0].prepFundingUsd, 10.95);
});

test("canary route plan prefers affordable unchecked amount over larger shortfall amount", () => {
  const routeKey = `bob:${WBTC_OFT}->bsc:${WBTC_OFT}`;
  const plan = buildCanaryRoutePlan(
    {
      quotes: [
        quote({
          routeKey,
          srcChain: "bob",
          dstChain: "bsc",
          amount: "10000",
          inputAmount: "10000",
          txValueWei: "320661268633384",
        }),
        quote({
          routeKey,
          srcChain: "bob",
          dstChain: "bsc",
          amount: "2000",
          inputAmount: "2000",
          txValueWei: "320661268633384",
        }),
      ],
      scores: [
        score({ routeKey, amount: "10000", srcChain: "bob", dstChain: "bsc" }),
        score({ routeKey, amount: "2000", srcChain: "bob", dstChain: "bsc", inputUsd: 1.46 }),
      ],
      readinessRecords: [
        {
          observedAt: "2026-04-18T01:05:00.000Z",
          address: ADDRESS,
          routeKey,
          amount: "1000",
          srcChain: "bob",
          dstChain: "bsc",
          native: { balanceWei: "3583671694530020", requiredWei: "320661268633384", shortfallWei: "0", ok: true },
          token: { token: WBTC_OFT, balance: "2141", required: "1000", shortfall: "0", ok: true },
          allowance: null,
          overallReady: true,
        },
      ],
      readinessFailures: [],
    },
    { address: ADDRESS, prices: { nativeByChain: { bob: 2421.47 } } },
  );

  assert.equal(plan.topCandidates[0].amount, "2000");
  assert.deepEqual(plan.topCandidates[0].prepBlockers, ["wallet_not_checked"]);
  assert.equal(plan.topCandidates[0].prepFundingUsd, 0);
  assert.equal(plan.topCandidates[1].amount, "10000");
  assert.equal(plan.topCandidates[1].prepBlockers.includes("token"), true);
  assert.equal(plan.topCandidates[1].prepFundingUsd, 5.73707);
});

test("canary route plan demotes reject-no-edge routes behind unresolved candidates", () => {
  const negativeRouteKey = `avalanche:${WBTC_OFT}->soneium:${WBTC_OFT}`;
  const unresolvedRouteKey = `base:${WBTC_OFT}->ethereum:${WBTC_OFT}`;
  const plan = buildCanaryRoutePlan(
    {
      quotes: [
        quote({ routeKey: negativeRouteKey, srcChain: "avalanche", dstChain: "soneium" }),
        quote({ routeKey: unresolvedRouteKey, srcChain: "base", dstChain: "ethereum" }),
      ],
      scores: [
        {
          ...score({ routeKey: negativeRouteKey, srcChain: "avalanche", dstChain: "soneium" }),
          tradeReadiness: "reject_no_net_edge",
          netEdgeUsd: -0.6,
        },
        {
          ...score({ routeKey: unresolvedRouteKey, srcChain: "base", dstChain: "ethereum" }),
          tradeReadiness: "insufficient_data",
          netEdgeUsd: -0.4,
        },
      ],
      readinessRecords: [],
      readinessFailures: [],
    },
    { address: ADDRESS, prices: { nativeByChain: { avalanche: 20, base: 1800 } } },
  );

  assert.equal(plan.topCandidates[0].routeKey, unresolvedRouteKey);
  assert.equal(plan.topCandidates[1].routeKey, negativeRouteKey);
  assert.equal(plan.topCandidates[1].objectiveRejected, true);
});

test("canary route plan promotes positive-edge candidates ahead of negative token-blocked routes", () => {
  const negativeRouteKey = `sonic:${WBTC_OFT}->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599`;
  const positiveRouteKey = `bob:${WBTC_OFT}->base:${WBTC_OFT}`;
  const plan = buildCanaryRoutePlan(
    {
      quotes: [
        quote({ routeKey: negativeRouteKey, srcChain: "sonic", dstChain: "ethereum", amount: "10000" }),
        quote({ routeKey: positiveRouteKey, srcChain: "bob", dstChain: "base", amount: "100000" }),
      ],
      scores: [
        {
          ...score({ routeKey: negativeRouteKey, amount: "10000", srcChain: "sonic", dstChain: "ethereum", inputUsd: 7.58 }),
          netEdgeUsd: -1.18,
        },
        {
          ...score({ routeKey: positiveRouteKey, amount: "100000", srcChain: "bob", dstChain: "base", inputUsd: 75.8 }),
          netEdgeUsd: 0.27,
        },
      ],
      readinessRecords: [
        {
          observedAt: "2026-04-18T01:05:00.000Z",
          address: ADDRESS,
          routeKey: negativeRouteKey,
          amount: "10000",
          srcChain: "sonic",
          dstChain: "ethereum",
          native: { shortfallWei: "0", ok: true },
          token: { token: WBTC_OFT, balance: "0", required: "10000", shortfall: "10000", ok: false },
          allowance: null,
          overallReady: false,
        },
        {
          observedAt: "2026-04-18T01:06:00.000Z",
          address: ADDRESS,
          routeKey: positiveRouteKey,
          amount: "100000",
          srcChain: "bob",
          dstChain: "base",
          native: { shortfallWei: "0", ok: true },
          token: { token: WBTC_OFT, balance: "0", required: "100000", shortfall: "100000", ok: false },
          allowance: null,
          overallReady: false,
        },
      ],
      readinessFailures: [],
    },
    {
      address: ADDRESS,
      prices: { nativeByChain: { bob: 2421.47, sonic: 0.047 } },
    },
  );

  assert.equal(plan.topCandidates[0].routeKey, positiveRouteKey);
  assert.equal(plan.topCandidates[0].netEdgeUsd > 0, true);
  assert.equal(plan.topCandidates[1].routeKey, negativeRouteKey);
});
