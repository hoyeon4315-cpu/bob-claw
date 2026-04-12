import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStrategyRefreshPlans } from "../src/strategy/strategy-refresh-plans.mjs";

test("strategy refresh plans emit concrete commands for stable and proxy evidence gaps", () => {
  const plans = buildStrategyRefreshPlans({
    crossAssetArbitrage: {
      bestAmountLadderPair: {
        entryRouteKey: "base:0xusdc->bitcoin:0xbtc",
        exitRouteKey: "bitcoin:0xbtc->base:0xusdc",
        blockerCounts: [{ blocker: "amount_mismatch", count: 3 }],
      },
    },
    btcProxySpreads: {
      nextCoverageTarget: {
        proxyGroup: "wbtc",
        nextAction: "expand_amount_ladder",
        reason: "partial_amount_match",
        buyChains: ["base"],
        sellChains: ["sonic", "unichain"],
      },
    },
  });

  assert.equal(plans.stableLoop.nextAction, "expand_amount_ladder");
  assert.equal(plans.stableLoop.command, "npm run quote:dex -- --route-key=base:0xusdc->bitcoin:0xbtc --include-stable-entry");
  assert.equal(plans.proxySpread.nextAction, "expand_amount_ladder");
  assert.equal(plans.proxySpread.command, "npm run quote:dex -- --chains=base,sonic,unichain --include-stable-entry --route-limit=64");
});
