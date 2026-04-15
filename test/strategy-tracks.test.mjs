import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStrategyTracksSummary } from "../src/strategy/strategy-tracks.mjs";

test("strategy tracks stay conservative for blocked stable loops and overfit proxy spreads", () => {
  const summary = buildStrategyTracksSummary({
    crossAssetArbitrage: {
      bestLoop: {
        entryRouteKey: "base:usdc->bitcoin:btc",
        exitRouteKey: "bitcoin:btc->base:usdc",
        entryAmount: "4000000",
        loopNetEdgeUsd: 0.82,
        blockers: ["entry_stale_dex_output_quote"],
      },
    },
    btcProxySpreads: {
      bestRebalanceOpportunity: {
        buyChain: "base",
        sellChain: "sonic",
        proxyTicker: "wBTC.OFT",
        amount: "10000",
        policyReadyAfterRebalance: true,
        blockers: [],
      },
      overfitAssessment: "high_overfit_risk",
      overfitRisks: ["all_quotes_stale"],
      nextCoverageTarget: {
        proxyGroup: "wbtc",
        nextAction: "expand_amount_ladder",
        reason: "partial_amount_match",
      },
      unmatchedObservedProxyGroups: [],
    },
  });

  const stableLoop = summary.tracks.find((item) => item.kind === "stable_loop");
  const proxySpread = summary.tracks.find((item) => item.kind === "proxy_spread");

  assert.equal(stableLoop.status, "blocked_loop");
  assert.equal(stableLoop.nextActionCode, "refresh_stable_loop_quotes");
  assert.equal(stableLoop.reason, "entry_stale_dex_output_quote");
  assert.equal(proxySpread.status, "thin_coverage");
  assert.equal(proxySpread.nextActionCode, "expand_amount_ladder");
  assert.equal(proxySpread.reason, "partial_amount_match");
});

test("strategy tracks only promote blocker-free durable candidates", () => {
  const summary = buildStrategyTracksSummary({
    shadowCycle: {
      topRoute: {
        label: "bob->base wBTC.OFT->wBTC.OFT",
        routeKey: "bob:0x0555->base:0x0555",
        amount: "10000",
        tradeReadiness: "reject_no_net_edge",
      },
      shadowActions: [
        { code: "wait_for_fresh_inputs", reason: "reject_no_net_edge" },
      ],
    },
    crossAssetArbitrage: {
      bestLoop: {
        entryRouteKey: "base:usdc->bitcoin:btc",
        exitRouteKey: "bitcoin:btc->base:usdc",
        entryAmount: "4000000",
        loopNetEdgeUsd: 0.82,
        blockers: [],
      },
    },
    btcProxySpreads: {
      bestRebalanceOpportunity: {
        buyChain: "base",
        sellChain: "sonic",
        proxyTicker: "wBTC.OFT",
        amount: "10000",
        policyReadyAfterRebalance: true,
        blockers: [],
      },
      overfitAssessment: "coverage_ok",
      overfitRisks: [],
      unmatchedObservedProxyGroups: [],
    },
  });

  const stableLoop = summary.tracks.find((item) => item.kind === "stable_loop");
  const proxySpread = summary.tracks.find((item) => item.kind === "proxy_spread");

  assert.equal(stableLoop.status, "candidate_loop");
  assert.equal(stableLoop.nextActionCode, "validate_loop_durability");
  assert.equal(proxySpread.status, "candidate_spread");
  assert.equal(proxySpread.nextActionCode, "validate_proxy_durability");
});

test("strategy tracks include an ETH-family observe-only research track when ETH evidence exists", () => {
  const summary = buildStrategyTracksSummary({
    ethProfitability: {
      gatewayRouteCount: 3,
      routeCount: 1,
      measuredClosedLoopCount: 1,
      profitableClosedLoopCount: 0,
      verdictCode: "positive_but_below_policy",
      recommendationCode: "collect_more_eth_evidence",
      bestMeasuredRoute: {
        routeKey: "base:0x0->ethereum:0x0",
        amount: "10000",
      },
      bestResearchRoute: {
        routeKey: "base:0x0->ethereum:0x0",
        amount: "10000",
      },
      followUpActionCode: "collect_eth_family_evidence",
      followUpCommand: "npm run analyze:ethereum-routes -- --write && npm run audit:eth-family-overfit && npm run status:dashboard",
    },
  });

  const ethTrack = summary.tracks.find((item) => item.kind === "eth_family_loop");

  assert.equal(Boolean(ethTrack), true);
  assert.equal(ethTrack.label, "base:0x0->ethereum:0x0");
  assert.equal(ethTrack.status, "thin_coverage");
  assert.equal(ethTrack.nextActionCode, "collect_eth_family_evidence");
  assert.equal(ethTrack.reason, "collect_more_eth_evidence");
  assert.match(ethTrack.command, /audit:eth-family-overfit/);
});
