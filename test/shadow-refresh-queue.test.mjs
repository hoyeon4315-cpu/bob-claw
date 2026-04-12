import assert from "node:assert/strict";
import { test } from "node:test";
import { buildShadowRefreshQueue } from "../src/session/shadow-refresh-queue.mjs";

test("shadow refresh queue prioritizes canary readiness, strategy coverage, and ops follow-ups", () => {
  const queue = buildShadowRefreshQueue({
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    nextReadinessCheck: {
      routeKey: "base:0x0555->bitcoin:btc",
      label: "base->bitcoin ETH->BTC",
      amount: "1787455313617158",
    },
    shadowActions: [
      {
        role: "active_canary",
        routeKey: "bob:0x0555->base:0x0555",
        label: "bob->base wBTC.OFT->wBTC.OFT",
        amount: "10000",
        code: "wait_for_fresh_inputs",
        actionLabel: "wait for fresher market inputs",
        reason: "reject_no_net_edge",
        command: null,
      },
      {
        role: "tx_ready_shadow",
        routeKey: "ethereum:0x2260->base:0x0555",
        label: "ethereum->base WBTC->wBTC.OFT",
        amount: "10000",
        code: "check_wallet_readiness",
        actionLabel: "refresh wallet readiness",
        reason: "native",
        command: "npm run check:estimator-wallet -- --route-key=ethereum:0x2260->base:0x0555 --amount=10000 --address=0x96262be63aa687563789225c2fe898c27a3b0ae4",
      },
    ],
    strategyPlans: {
      stableLoop: {
        kind: "stable_loop",
        nextAction: "expand_amount_ladder",
        reason: "amount_mismatch",
        command: "npm run quote:dex -- --route-key=base:0xusdc->bitcoin:0xbtc --include-stable-entry",
        routeKeys: ["base:0xusdc->bitcoin:0xbtc", "bitcoin:0xbtc->base:0xusdc"],
      },
      proxySpread: {
        kind: "proxy_spread",
        nextAction: "expand_amount_ladder",
        reason: "partial_amount_match",
        command: "npm run quote:dex -- --chains=base,sonic,unichain --include-stable-entry --route-limit=64",
        chains: ["base", "sonic", "unichain"],
        proxyGroup: "wbtc",
      },
    },
    mode: "CANARY_PREP_BLOCKED",
    enabledRouteCount: 0,
    treasuryDecision: "BLOCKED",
    fundingReasonCount: 2,
  });

  assert.deepEqual(
    queue.map((item) => [item.rank, item.scope, item.code]),
    [
      [1, "canary", "check_wallet_readiness"],
      [2, "tx_ready_shadow", "check_wallet_readiness"],
      [3, "stable_loop", "expand_amount_ladder"],
      [4, "proxy_spread", "expand_amount_ladder"],
      [5, "canary", "advance_canary"],
      [6, "route_performance", "report_route_performance"],
      [7, "treasury", "plan_treasury_actions"],
      [8, "funding", "plan_treasury_funding_sources"],
    ],
  );
  assert.equal(queue[2].command, "npm run quote:dex -- --route-key=base:0xusdc->bitcoin:0xbtc --include-stable-entry");
  assert.equal(queue[3].proxyGroup, "wbtc");
});
