import assert from "node:assert/strict";
import { test } from "node:test";
import { buildForkSignerIntent } from "../src/cli/submit-prelive-fork-execution.mjs";
import { buildForkExecutionPlan } from "../src/prelive/fork-execution.mjs";

const WBTC = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

test("fork signer intent is derived from the fork plan transaction payload", () => {
  const plan = buildForkExecutionPlan({
    selection: {
      routeKey: `avalanche:${WBTC}->bob:${WBTC}`,
      amount: "50000",
      label: "avalanche->bob wBTC.OFT->wBTC.OFT",
      score: {
        routeKey: `avalanche:${WBTC}->bob:${WBTC}`,
        amount: "50000",
        srcChain: "avalanche",
        dstChain: "bob",
        inputUsd: 37.93,
        tradeReadiness: "insufficient_data",
        srcAsset: { chain: "avalanche", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
        dstAsset: { chain: "bob", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
      },
      quote: {
        routeKey: `avalanche:${WBTC}->bob:${WBTC}`,
        amount: "50000",
        route: { srcChain: "avalanche", dstChain: "bob" },
        txTo: "0x1111111111111111111111111111111111111111",
        txData: "0x1234",
        txValueWei: "42",
      },
    },
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    now: "2026-04-19T00:00:00.000Z",
  });

  const intent = buildForkSignerIntent(plan, { observedAt: "2026-04-19T00:00:01.000Z" });

  assert.equal(intent.strategyId, "prelive_fork_execution");
  assert.equal(intent.chain, "avalanche");
  assert.equal(intent.mode, "fork");
  assert.equal(intent.intentType, "prelive_fork_execution");
  assert.equal(intent.amountUsd, 37.93);
  assert.deepEqual(intent.tx, {
    to: "0x1111111111111111111111111111111111111111",
    data: "0x1234",
    value: "42",
  });
  assert.equal(intent.metadata.preliveForkPlanId, plan.planId);
  assert.equal(intent.metadata.preliveForkRouteKey, plan.routeKey);
  assert.equal(intent.metadata.preliveForkAmount, "50000");
});

test("fork execution plan submit command prefers signer daemon plus fork rpc", () => {
  const plan = buildForkExecutionPlan({
    selection: {
      routeKey: `ethereum:${WBTC}->base:${WBTC}`,
      amount: "10000",
      label: "ethereum->base",
      score: {
        routeKey: `ethereum:${WBTC}->base:${WBTC}`,
        amount: "10000",
        srcChain: "ethereum",
        dstChain: "base",
        inputUsd: 7.3,
        tradeReadiness: "shadow_candidate_review_only",
        srcAsset: { chain: "ethereum", token: WBTC, ticker: "WBTC", decimals: 8, isNative: false, priceKey: "btc" },
        dstAsset: { chain: "base", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
      },
      quote: {
        routeKey: `ethereum:${WBTC}->base:${WBTC}`,
        amount: "10000",
        route: { srcChain: "ethereum", dstChain: "base" },
        txTo: "0x1111111111111111111111111111111111111111",
        txData: "0x1234",
        txValueWei: "0",
      },
    },
    address: "0x000000000000000000000000000000000000dEaD",
    now: "2026-04-19T00:00:00.000Z",
  });

  assert.match(plan.commands.submit, /--use-signer-daemon/);
  assert.match(plan.commands.submit, /--rpc-url="<forkRpcUrl>"/);
});
