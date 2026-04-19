import assert from "node:assert/strict";
import { test } from "node:test";

import { mergePlans, refreshSelectionExecutableQuote } from "../src/cli/plan-prelive-fork-execution.mjs";
import { buildForkExecutionPlan } from "../src/prelive/fork-execution.mjs";

const WBTC = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

test("mergePlans preserves existing fork plans for other routes while replacing same selection", () => {
  const existing = {
    source: "objective",
    selectedCount: 1,
    plans: [
      {
        planId: "exact-1",
        routeKey: "avalanche:wbtc->soneium:wbtc",
        amount: "10000",
        selectionSource: "exact_route",
      },
      {
        planId: "queue-1",
        routeKey: "unichain:wbtc->sonic:wbtx",
        amount: "10000",
        selectionSource: "queue",
      },
    ],
  };
  const next = {
    source: "objective",
    selectedCount: 1,
    plans: [
      {
        planId: "queue-2",
        routeKey: "unichain:wbtc->sonic:wbtx",
        amount: "10000",
        selectionSource: "queue",
      },
    ],
  };

  const merged = mergePlans(existing, next);
  assert.equal(merged.source, "objective");
  assert.equal(merged.selectedCount, 2);
  assert.deepEqual(
    merged.plans.map((plan) => plan.planId),
    ["queue-2", "exact-1"],
  );
});

test("mergePlans marks mixed sources when exact-route and objective plans coexist", () => {
  const existing = {
    source: "exact_route",
    selectedCount: 1,
    plans: [{ planId: "exact-1", routeKey: "a", amount: "1", selectionSource: "exact_route" }],
  };
  const next = {
    source: "objective",
    selectedCount: 1,
    plans: [{ planId: "queue-1", routeKey: "b", amount: "1", selectionSource: "queue" }],
  };

  const merged = mergePlans(existing, next);
  assert.equal(merged.source, "mixed");
  assert.equal(merged.selectedCount, 2);
});

test("mergePlans preserves replaced selections that already have execution records", () => {
  const existing = {
    source: "exact_route",
    selectedCount: 1,
    plans: [
      {
        planId: "old-submitted-plan",
        routeKey: "avalanche:wbtc->soneium:wbtc",
        amount: "10000",
        selectionSource: "exact_route",
      },
    ],
  };
  const next = {
    source: "exact_route",
    selectedCount: 1,
    plans: [
      {
        planId: "new-plan",
        routeKey: "avalanche:wbtc->soneium:wbtc",
        amount: "10000",
        selectionSource: "exact_route",
      },
    ],
  };

  const merged = mergePlans(existing, next, {
    preservePlanIds: new Set(["old-submitted-plan"]),
  });

  assert.deepEqual(
    merged.plans.map((plan) => plan.planId),
    ["new-plan", "old-submitted-plan"],
  );
});

test("fork execution plan blocks quotes addressed to a non-operational recipient", () => {
  const plan = buildForkExecutionPlan({
    selection: {
      routeKey: `sonic:${WBTC}->bob:${WBTC}`,
      amount: "10000",
      label: "sonic->bob",
      quote: {
        routeKey: `sonic:${WBTC}->bob:${WBTC}`,
        amount: "10000",
        route: { srcChain: "sonic", dstChain: "bob" },
        sender: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
        recipient: "0x000000000000000000000000000000000000dEaD",
        txTo: WBTC,
        txData: "0x1234",
        txValueWei: "1",
      },
    },
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    now: "2026-04-19T00:00:00.000Z",
  });

  assert.equal(plan.status, "blocked");
  assert.deepEqual(plan.blockers, ["quote_recipient_mismatch"]);
  assert.equal(plan.commands.submit, null);
});

test("fork execution plan blocks verify-recipient addresses embedded in calldata", () => {
  const paddedDead = "000000000000000000000000000000000000000000000000000000000000dead";
  const plan = buildForkExecutionPlan({
    selection: {
      routeKey: `sonic:${WBTC}->bob:${WBTC}`,
      amount: "10000",
      label: "sonic->bob",
      quote: {
        routeKey: `sonic:${WBTC}->bob:${WBTC}`,
        amount: "10000",
        route: { srcChain: "sonic", dstChain: "bob" },
        txTo: WBTC,
        txData: `0x1234${paddedDead}`,
        txValueWei: "1",
      },
    },
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    now: "2026-04-19T00:00:00.000Z",
  });

  assert.equal(plan.status, "blocked");
  assert.deepEqual(plan.blockers, ["quote_verify_recipient_in_tx_data"]);
  assert.equal(plan.commands.submit, null);
});

test("refreshSelectionExecutableQuote refetches exact-route executable calldata for the operator address", async () => {
  const operator = "0x96262be63aa687563789225c2fe898c27a3b0ae4";
  const selection = {
    routeKey: `base:${WBTC}->bsc:${WBTC}`,
    amount: "300",
    label: "base->bsc",
    quote: {
      route: { srcChain: "base", dstChain: "bsc", srcToken: WBTC, dstToken: WBTC },
      txTo: WBTC,
      txData: `0x123400000000000000000000000000000000000000000000000000000000dead`,
      txValueWei: "1",
    },
  };
  const requested = [];
  const refreshed = await refreshSelectionExecutableQuote(selection, {
    address: operator,
    client: {
      async getQuote(params) {
        requested.push(params);
        return {
          body: {
            layerZero: {
              tx: {
                to: WBTC,
                data: `0x123400000000000000000000${operator.slice(2).toLowerCase()}`,
                value: "7",
                chain: "base",
              },
            },
          },
        };
      },
    },
    hydrateExecutionImpl: async (body) => ({
      txTo: body.layerZero.tx.to,
      txData: body.layerZero.tx.data,
      txValueWei: String(body.layerZero.tx.value),
      txChain: body.layerZero.tx.chain,
      txDataBytes: Math.max(0, (body.layerZero.tx.data.length - 2) / 2),
    }),
  });

  assert.deepEqual(requested, [
    {
      srcChain: "base",
      dstChain: "bsc",
      srcToken: WBTC,
      dstToken: WBTC,
      amount: "300",
      recipient: operator,
      slippage: "50",
      sender: operator,
    },
  ]);
  assert.equal(refreshed.quote.recipient, operator);
  assert.equal(refreshed.quote.sender, operator);
  assert.equal(refreshed.quote.txValueWei, "7");

  const plan = buildForkExecutionPlan({
    selection: refreshed,
    address: operator,
    now: "2026-04-19T00:00:00.000Z",
  });
  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.blockers, []);
});
