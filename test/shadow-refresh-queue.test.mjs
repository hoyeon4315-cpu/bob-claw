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
        routeKey: "avalanche:0x0555->bsc:0x0555",
        label: "avalanche->bsc wBTC.OFT->wBTC.OFT",
        amount: "10000",
        code: "check_wallet_readiness",
        actionLabel: "refresh wallet readiness",
        reason: "native",
        command: "npm run check:estimator-wallet -- --route-key=avalanche:0x0555->bsc:0x0555 --amount=10000 --address=0x96262be63aa687563789225c2fe898c27a3b0ae4",
      },
    ],
    objectivePlans: {
      executionReview: {
        routeKey: "ethereum:0x2260->base:0x0555",
        label: "ethereum->base WBTC->wBTC.OFT",
        amount: "10000",
        status: "measured_hypothesis_under_review",
        selectionCode: "prefer_viable_prep_route_over_measured_hypothesis",
        blockers: ["wallet_not_checked"],
        nextActionCode: "check_wallet_readiness",
        nextActionLabel: "wallet readiness check",
        command: "npm run check:estimator-wallet -- --route-key=ethereum:0x2260->base:0x0555 --amount=10000 --address=0x96262be63aa687563789225c2fe898c27a3b0ae4",
      },
      discovery: {
        routeKey: "base:0x0555->unichain:0x0555",
        label: "base->unichain wBTC.OFT->wBTC.OFT",
        amount: "25000",
        source: "secondary_measured_loop",
        status: "missing_decay_survival",
        selectionCode: "secondary_measured_loop",
        reason: "missing_decay_survival",
        nextActionCode: "collect_decay_survival",
        nextActionLabel: "collect decay survival samples",
        command: "npm run verify:gateway -- --route-key=base:0x0555->unichain:0x0555 --amounts=25000 && npm run quote:dex -- --route-key=base:0x0555->unichain:0x0555 --amount=25000 --include-stable-entry && npm run score:gateway -- --write --route-key=base:0x0555->unichain:0x0555 --amount=25000",
      },
    },
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
      [3, "execution_review", "check_wallet_readiness"],
      [4, "stable_loop", "expand_amount_ladder"],
      [5, "proxy_spread", "expand_amount_ladder"],
      [6, "strategy_discovery", "collect_decay_survival"],
      [7, "canary", "advance_canary"],
      [8, "route_performance", "report_route_performance"],
    ],
  );
  assert.equal(queue[2].command.includes("ethereum:0x2260->base:0x0555"), true);
  assert.equal(queue[3].command, "npm run quote:dex -- --route-key=base:0xusdc->bitcoin:0xbtc --include-stable-entry");
  assert.equal(queue[4].proxyGroup, "wbtc");
  assert.equal(queue[5].command.includes("verify:gateway"), true);
});

test("shadow refresh queue adds ETH-family observe-only evidence when surface changes", () => {
  const queue = buildShadowRefreshQueue({
    ethFamilyWatch: {
      observedAt: "2026-04-12T12:00:00.000Z",
      routeCount: 2,
      surfaceChanged: true,
      addedRoutes: [
        "base:0xeth->bob:0xeth",
        "unichain:0xeth->base:0xeth",
      ],
      removedRoutes: [],
      chainPairs: ["base->bob", "unichain->base"],
      addedChainPairs: ["base->bob", "unichain->base"],
      removedChainPairs: [],
    },
  });

  assert.equal(queue[0].scope, "eth_family_watch");
  assert.equal(queue[0].code, "collect_eth_family_evidence");
  assert.equal(queue[0].reason, "eth_family_surface_added");
  assert.equal(queue[0].routeLabel, "ETH-family watch base->bob");
  assert.deepEqual(queue[0].chains, ["base", "bob", "unichain"]);
  assert.equal(queue[0].routeKeys.length, 2);
  assert.equal(queue[0].command.includes("scan:quote-surface"), true);
  assert.equal(queue[0].command.includes("analyze:ethereum-routes"), true);
  assert.equal(queue[0].command.includes("audit:eth-family-overfit"), true);
  assert.equal(queue[0].command.includes("status:dashboard"), true);
});
