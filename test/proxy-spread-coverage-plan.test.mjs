import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBtcProxySpreadSummary } from "../src/strategy/btc-proxy-spreads.mjs";
import { buildProxySpreadCoveragePlan, summarizeProxySpreadCoveragePlan } from "../src/strategy/proxy-spread-coverage-plan.mjs";
import { trustedOdosQuote } from "./helpers/trusted-odos-quote.mjs";

const WBTC_OFT = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
const WBTC = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

test("proxy spread coverage plan prioritizes missing-side expansion with explicit quota", () => {
  const plan = buildProxySpreadCoveragePlan({
    proxySpreadSummary: {
      generatedAt: "2026-04-14T00:00:00.000Z",
      overfitAssessment: "high_overfit_risk",
      overfitRisks: ["thin_buy_quote_coverage", "all_quotes_stale"],
      unmatchedObservedProxyGroups: [],
      coverageTargets: [
        {
          proxyGroup: "wbtc",
          buyAmountLevelCount: 0,
          sellAmountLevelCount: 2,
          matchedAmountLevelCount: 0,
          buyChainCount: 0,
          sellChainCount: 2,
          buyChains: [],
          sellChains: ["base", "ethereum"],
          buyAmountLevels: [],
          sellAmountLevels: ["10000", "25000"],
          matchedAmountLevels: [],
          freshestBuyAgeMinutes: null,
          freshestSellAgeMinutes: 45,
          nextAction: "expand_missing_side",
          reason: "missing_buy_side",
        },
      ],
    },
  });

  assert.equal(plan.summary.nextProxyGroup, "wbtc");
  assert.equal(plan.summary.nextAction, "expand_missing_side");
  assert.equal(plan.plan[0].priority, "critical");
  assert.equal(plan.plan[0].quoteQuotaNeeded, 8);
  assert.equal(plan.plan[0].targetAmountLevels[0], "10000");
  assert.match(plan.plan[0].executionCommand, /npm run quote:dex/);
});

test("proxy spread coverage plan turns partial amount matching into a ladder expansion action", () => {
  const summary = buildBtcProxySpreadSummary(
    {
      dexQuotes: [
        trustedOdosQuote({
          observedAt: "2026-04-12T00:00:00.000Z",
          quoteType: "stable_to_token",
          source: "gateway_src_entry_leg",
          chain: "base",
          inputToken: USDC_BASE,
          inputTicker: "USDC",
          outputToken: WBTC_OFT,
          outputTicker: "wBTC.OFT",
          targetTokenAmount: "10000",
          outputAmount: "10010",
          inputValueUsd: 7.0,
          gasEstimateValueUsd: 0.01,
        }),
        trustedOdosQuote({
          observedAt: "2026-04-12T00:00:01.000Z",
          quoteType: "stable_to_token",
          source: "gateway_src_entry_leg",
          chain: "ethereum",
          inputToken: USDC_ETH,
          inputTicker: "USDC",
          outputToken: WBTC,
          outputTicker: "WBTC",
          targetTokenAmount: "25000",
          outputAmount: "25010",
          inputValueUsd: 17.0,
          gasEstimateValueUsd: 0.02,
        }),
        trustedOdosQuote({
          observedAt: "2026-04-12T00:00:02.000Z",
          quoteType: "token_to_stable",
          source: "gateway_dst_leg",
          chain: "base",
          inputToken: WBTC_OFT,
          inputTicker: "wBTC.OFT",
          outputToken: USDC_BASE,
          outputTicker: "USDC",
          inputAmount: "10000",
          netOutputValueUsd: 7.25,
          gasEstimateValueUsd: 0.01,
        }),
      ],
      routes: [
        {
          srcChain: "ethereum",
          dstChain: "base",
          srcToken: WBTC,
          dstToken: WBTC_OFT,
        },
      ],
      scoreSnapshot: {
        scores: [
          {
            routeKey: "ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599->base:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
            amount: "25000",
            knownCostUsd: 0.1,
            tradeReadiness: "shadow_candidate_review_only",
            dataGaps: [],
          },
        ],
      },
    },
    { now: "2026-04-12T00:10:00.000Z" },
  );
  const plan = buildProxySpreadCoveragePlan({ proxySpreadSummary: summary });
  const summaryView = summarizeProxySpreadCoveragePlan(plan);

  assert.equal(summary.nextCoverageTarget.nextAction, "expand_amount_ladder");
  assert.equal(plan.summary.nextAction, "expand_amount_ladder");
  assert.equal(plan.plan[0].proxyGroup, "wbtc");
  assert.equal(plan.plan[0].targetAmountLevels.includes("25000"), true);
  assert.match(plan.plan[0].executionCommand, /score:gateway/);
  assert.equal(summaryView.nextProxyGroup, "wbtc");
  assert.equal(summaryView.nextAction, "expand_amount_ladder");
});
