import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getRecipeForBlocker,
  registerBlockerRecipe,
  RECIPE_KINDS,
} from "../../../src/executor/blocker-resolution/recipes.mjs";

test("recipes resolve exact codes before category fallbacks and expose ROI metadata", () => {
  const route = getRecipeForBlocker({
    code: "proof_acquisition:route_quote_stale",
    params: { routeKey: "base->bob", expectedDailyUsdOnResolve: 4.25 },
  });
  assert.equal(route.recipeId, "refresh_route_quote");
  assert.equal(route.kind, "auto_proof_acquisition");
  assert.equal(route.costClass, "cheap");
  assert.equal(route.expectedDailyUsdOnResolve({ expectedDailyUsdOnResolve: 4.25 }), 4.25);

  const fallback = getRecipeForBlocker({
    code: "proof_acquisition:gateway_route_unknown",
    params: {},
  });
  assert.equal(fallback.kind, "auto_proof_acquisition");
  assert.ok(RECIPE_KINDS.includes(fallback.kind));
});

test("hard safety stop codes cannot register recipes", () => {
  assert.throws(
    () => registerBlockerRecipe("hard_safety_stop:kill_switch_active", {
      recipeId: "bad",
      kind: "hard_safety_stop",
      costClass: "cheap",
      dependencies: [],
      build: () => ({}),
    }),
    /hard_safety_stop/,
  );
});

test("reward and refill recipes build policy-routed actions without signer authority", () => {
  const reward = getRecipeForBlocker({
    code: "proof_acquisition:rewards_unclaimed",
    params: { strategyId: "merkl-live", chain: "base", claimableUsd: 12 },
  });
  const rewardAction = reward.build({
    code: "proof_acquisition:rewards_unclaimed",
    params: { strategyId: "merkl-live", chain: "base", claimableUsd: 12 },
    context: {},
  });
  assert.equal(rewardAction.type, "operational_intent");
  assert.equal(rewardAction.intent.intentType, "claim_and_swap_rewards");
  assert.equal(rewardAction.authority, "capital_manager_queue");

  const refill = getRecipeForBlocker({
    code: "refill_or_inventory:chain_under_target",
    params: { strategyId: "s1", chain: "base", shortfallUsd: 8 },
  });
  assert.equal(refill.requiresExternalDeposit, false);
  assert.equal(refill.build({ code: "refill_or_inventory:chain_under_target", params: { chain: "base" }, context: {} }).authority, "capital_manager_queue");
});

test("missing yield evidence recipe runs yield-position simulation proof acquisition", () => {
  const recipe = getRecipeForBlocker({
    code: "proof_acquisition:missing_yield_evidence",
    params: { strategyId: "aerodrome-cl-base" },
  });
  const action = recipe.build({
    code: "proof_acquisition:missing_yield_evidence",
    params: { strategyId: "aerodrome-cl-base" },
    context: {},
  });
  assert.equal(recipe.kind, "auto_proof_acquisition");
  assert.equal(action.type, "refresh_command");
  assert.equal(action.command, "npm run run:yield-position-sims -- --write-shadow-edge");
});
