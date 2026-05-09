import { BLOCKER_CODES, assertBlockerCode, isHardSafetyStop } from "../policy/blocker-codes.mjs";

export const RECIPE_KINDS = Object.freeze([
  "auto_proof_acquisition",
  "auto_operational",
  "time_bounded_wait",
  "code_required",
  "manual_operator_review",
  "economic_no_go",
  "hard_safety_stop",
]);

export const COST_CLASSES = Object.freeze(["cheap", "medium", "expensive"]);

const exactRecipes = new Map();
const categoryRecipes = new Map();

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roiFromParams(params = {}) {
  return finiteNumber(params.expectedDailyUsdOnResolve) ?? finiteNumber(params.expectedDailyUsd) ?? null;
}

function capitalRoutingRow(params = {}, context = {}) {
  const strategyId = params.strategyId || null;
  if (!strategyId) return null;
  if (context.capitalRoutingByStrategy instanceof Map) {
    return context.capitalRoutingByStrategy.get(strategyId) || null;
  }
  return context.capitalRoutingByStrategy?.[strategyId] || null;
}

function roiFromCapitalRouting(params = {}, context = {}) {
  return finiteNumber(capitalRoutingRow(params, context)?.expectedDailyUsdOnResolve) ?? roiFromParams(params);
}

function capitalRoutingRequiresExternalDeposit(params = {}, context = {}) {
  const row = capitalRoutingRow(params, context);
  if (!row) return params.requiresExternalDeposit === true;
  if (row.classification === "needs_capital_acquisition") return true;
  if (row.classification === "ready_no_capital_change" || row.classification === "ready_with_capital_addition") return false;
  return params.requiresExternalDeposit === true;
}

function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== "object") throw new Error("recipe must be an object");
  if (!recipe.recipeId) throw new Error("recipeId required");
  if (!RECIPE_KINDS.includes(recipe.kind)) throw new Error(`invalid recipe kind: ${recipe.kind}`);
  if (!COST_CLASSES.includes(recipe.costClass)) throw new Error(`invalid costClass: ${recipe.costClass}`);
  if (!Array.isArray(recipe.dependencies)) throw new Error("dependencies must be an array");
  if (typeof recipe.build !== "function") throw new Error("build must be a function");
  return Object.freeze({
    requiresExternalDeposit: false,
    expectedDailyUsdOnResolve: roiFromParams,
    ...recipe,
  });
}

export function registerBlockerRecipe(code, recipe) {
  assertBlockerCode(code);
  if (isHardSafetyStop(code)) {
    throw new Error(`Cannot register recipe for hard_safety_stop code: ${code}`);
  }
  const normalized = validateRecipe(recipe);
  exactRecipes.set(code, normalized);
  return normalized;
}

export function registerCategoryRecipe(category, recipe) {
  if (!category || !Object.values(BLOCKER_CODES).some((meta) => meta.category === category)) {
    throw new Error(`Unknown blocker category: ${category}`);
  }
  if (category === "hard_safety_stop") {
    throw new Error("Cannot register category recipe for hard_safety_stop");
  }
  const normalized = validateRecipe(recipe);
  categoryRecipes.set(category, normalized);
  return normalized;
}

function proofCommandRecipe({ recipeId, script, dependencies = [], costClass = "cheap" }) {
  return {
    recipeId,
    kind: "auto_proof_acquisition",
    costClass,
    dependencies,
    expectedDailyUsdOnResolve: roiFromParams,
    build: ({ code, params }) => ({
      type: "refresh_command",
      code,
      command: script,
      args: params?.args || [],
      params,
      authority: "admission_remediation_runner",
      receiptRequired: false,
    }),
  };
}

registerBlockerRecipe("proof_acquisition:route_quote_stale", proofCommandRecipe({
  recipeId: "refresh_route_quote",
  script: "npm run verify:gateway -- --once",
  dependencies: ["gateway-api"],
}));

registerBlockerRecipe("proof_acquisition:gateway_route_unknown", proofCommandRecipe({
  recipeId: "refresh_gateway_route_availability",
  script: "npm run inventory:gateway",
  dependencies: ["gateway-api"],
}));

registerBlockerRecipe("proof_acquisition:inventory_snapshot_stale", proofCommandRecipe({
  recipeId: "refresh_wallet_holdings",
  script: "npm run report:wallet-holdings -- --json",
  dependencies: ["rpc-base"],
}));

registerBlockerRecipe("proof_acquisition:rewards_unclaimed", {
  recipeId: "claim_and_swap_rewards",
  kind: "auto_operational",
  costClass: "medium",
  dependencies: ["merkl-api", "rpc-base"],
  expectedDailyUsdOnResolve: roiFromParams,
  build: ({ code, params }) => ({
    type: "operational_intent",
    code,
    params,
    authority: "capital_manager_queue",
    receiptRequired: true,
    intent: {
      intentType: "claim_and_swap_rewards",
      strategyId: params.strategyId || null,
      chain: params.chain || null,
      claimableUsd: finiteNumber(params.claimableUsd),
      rewardToken: params.rewardToken || null,
    },
  }),
});

registerBlockerRecipe("proof_acquisition:missing_yield_evidence", proofCommandRecipe({
  recipeId: "run_yield_position_shadow_simulation",
  script: "npm run run:yield-position-sims -- --write-shadow-edge",
  dependencies: [],
}));

registerBlockerRecipe("refill_or_inventory:chain_under_target", {
  recipeId: "capital_refill_chain_under_target",
  kind: "auto_operational",
  costClass: "medium",
  dependencies: ["rpc-base", "gateway-api"],
  expectedDailyUsdOnResolve: roiFromParams,
  build: ({ code, params }) => ({
    type: "operational_intent",
    code,
    params,
    authority: "capital_manager_queue",
    receiptRequired: true,
    intent: {
      intentType: "capital_rebalance",
      strategyId: params.strategyId || null,
      chain: params.chain || null,
      amountUsd: finiteNumber(params.shortfallUsd) ?? finiteNumber(params.amountUsd),
    },
  }),
});

registerBlockerRecipe("refill_or_inventory:gas_float_below_threshold", {
  recipeId: "gas_float_top_up",
  kind: "auto_operational",
  costClass: "medium",
  dependencies: ["rpc-base"],
  expectedDailyUsdOnResolve: roiFromParams,
  build: ({ code, params }) => ({
    type: "operational_intent",
    code,
    params,
    authority: "capital_manager_queue",
    receiptRequired: true,
    intent: {
      intentType: "gas_float_top_up",
      strategyId: params.strategyId || null,
      chain: params.chain || null,
      amountUsd: finiteNumber(params.shortfallUsd) ?? finiteNumber(params.amountUsd),
    },
  }),
});

registerBlockerRecipe("refill_or_inventory:idle_dust_consolidation_due", {
  recipeId: "idle_inventory_consolidation",
  kind: "auto_operational",
  costClass: "medium",
  dependencies: ["rpc-base"],
  expectedDailyUsdOnResolve: roiFromParams,
  build: ({ code, params }) => ({
    type: "operational_intent",
    code,
    params,
    authority: "capital_manager_queue",
    receiptRequired: true,
    intent: {
      intentType: "idle_inventory_consolidation",
      strategyId: params.strategyId || null,
      chain: params.chain || null,
      amountUsd: finiteNumber(params.amountUsd),
    },
  }),
});

registerBlockerRecipe("economic_no_go:edge_below_variance_floor", {
  recipeId: "variance_floor_capital_routing_plan",
  kind: "auto_operational",
  costClass: "cheap",
  dependencies: [],
  requiresExternalDeposit: capitalRoutingRequiresExternalDeposit,
  expectedDailyUsdOnResolve: roiFromCapitalRouting,
  build: ({ code, params, context }) => {
    const row = capitalRoutingRow(params, context);
    if (!row) {
      return {
        type: "queue_entry",
        code,
        params,
        queue: "codex-blocker",
        reason: "capital_routing_plan_missing",
        fileToEdit: "src/cli/run-capital-routing-plan.mjs",
        receiptRequired: false,
      };
    }
    if (row.classification === "ready_with_capital_addition" && row.enqueueIntent) {
      return {
        type: "operational_intent",
        code,
        params,
        authority: "capital_manager_queue",
        receiptRequired: true,
        intent: row.enqueueIntent,
        classification: row.classification,
      };
    }
    if (row.classification === "ready_no_capital_change") {
      return {
        type: "refresh_command",
        code,
        command: "npm run report:strategy-execution-surfaces -- --write",
        args: [],
        params,
        reason: "capital_floor_already_reachable",
        receiptRequired: false,
      };
    }
    if (row.classification === "thin_evidence" || row.classification === "missing_input" || row.classification === "missing_yield_evidence") {
      return {
        type: "refresh_command",
        code,
        command: row.classification === "missing_yield_evidence"
          ? "npm run run:yield-position-sims -- --write-shadow-edge"
          : row.classification === "missing_input"
          ? "npm run run:prelive-simulations -- --source=objective --limit=4 --write --write-shadow-edge"
          : "npm run report:strategy-execution-surfaces -- --write",
        args: [],
        params,
        reason: row.classification,
        receiptRequired: false,
      };
    }
    if (row.classification === "ready_with_yield_shadow_evidence" || row.classification === "ready_with_shadow_evidence" || row.classification === "ready_with_sibling_proxy") {
      return {
        type: "refresh_command",
        code,
        command: "npm run capital:routing-plan -- --preview",
        args: [],
        params,
        reason: row.classification,
        receiptRequired: false,
      };
    }
    if (row.classification === "floor_infeasible_at_committed_caps" || row.classification === "negative_or_zero_edge") {
      return {
        type: "queue_entry",
        code: "code_required:specific_recipe_required",
        params: {
          ...params,
          classification: row.classification,
          recommendedFile: row.classification === "floor_infeasible_at_committed_caps"
            ? "src/config/strategy-caps.mjs"
            : "src/strategy/strategy-catalog.mjs",
        },
        queue: "codex-blocker",
        reason: row.classification,
        fileToEdit: row.classification === "floor_infeasible_at_committed_caps"
          ? "src/config/strategy-caps.mjs"
          : "src/strategy/strategy-catalog.mjs",
        receiptRequired: false,
      };
    }
    return {
      type: "queue_entry",
      code,
      params: { ...params, classification: row.classification || null },
      queue: "codex-blocker",
      reason: row.classification || "capital_routing_unresolved",
      receiptRequired: false,
    };
  },
});

registerCategoryRecipe("proof_acquisition", proofCommandRecipe({
  recipeId: "refresh_strategy_execution_surfaces",
  script: "npm run report:strategy-execution-surfaces -- --write",
  dependencies: [],
}));

registerCategoryRecipe("refill_or_inventory", {
  recipeId: "capital_manager_refill_plan",
  kind: "auto_operational",
  costClass: "medium",
  dependencies: ["rpc-base"],
  expectedDailyUsdOnResolve: roiFromParams,
  build: ({ code, params }) => ({
    type: "operational_intent",
    code,
    params,
    authority: "capital_manager_queue",
    receiptRequired: true,
    intent: {
      intentType: "capital_manager_refill_plan",
      strategyId: params.strategyId || null,
      chain: params.chain || null,
    },
  }),
});

registerCategoryRecipe("cooldown", {
  recipeId: "wait_for_eta",
  kind: "time_bounded_wait",
  costClass: "cheap",
  dependencies: [],
  expectedDailyUsdOnResolve: roiFromParams,
  build: ({ code, params }) => ({
    type: "wait",
    code,
    params,
    nextRetryAt: params.nextRetryAt || params.eta || null,
    receiptRequired: false,
  }),
});

registerCategoryRecipe("economic_no_go", {
  recipeId: "economic_recheck",
  kind: "economic_no_go",
  costClass: "cheap",
  dependencies: [],
  requiresExternalDeposit: true,
  expectedDailyUsdOnResolve: roiFromParams,
  build: ({ code, params }) => ({
    type: "economic_no_go",
    code,
    params,
    receiptRequired: false,
  }),
});

registerCategoryRecipe("executor_unbound", {
  recipeId: "queue_executor_binding_work",
  kind: "code_required",
  costClass: "cheap",
  dependencies: [],
  expectedDailyUsdOnResolve: roiFromParams,
  build: ({ code, params }) => ({
    type: "queue_entry",
    code,
    params,
    queue: "codex-blocker",
    reason: "executor_binding_required",
    receiptRequired: false,
  }),
});

registerCategoryRecipe("code_required", {
  recipeId: "queue_specific_recipe_work",
  kind: "code_required",
  costClass: "cheap",
  dependencies: [],
  expectedDailyUsdOnResolve: roiFromParams,
  build: ({ code, params }) => ({
    type: "queue_entry",
    code,
    params,
    queue: "codex-blocker",
    reason: "specific_recipe_required",
    receiptRequired: false,
  }),
});

registerCategoryRecipe("manual_review", {
  recipeId: "manual_operator_review",
  kind: "manual_operator_review",
  costClass: "cheap",
  dependencies: [],
  expectedDailyUsdOnResolve: roiFromParams,
  build: ({ code, params }) => ({
    type: "queue_entry",
    code,
    params,
    queue: "codex-blocker",
    reason: "manual_operator_review",
    receiptRequired: false,
  }),
});

registerCategoryRecipe("payback_lifecycle", {
  recipeId: "payback_lifecycle_surface_only",
  kind: "manual_operator_review",
  costClass: "cheap",
  dependencies: [],
  expectedDailyUsdOnResolve: roiFromParams,
  build: ({ code, params }) => ({
    type: "surface_only",
    code,
    params,
    reason: "payback_lifecycle_requires_operator_review",
    receiptRequired: false,
  }),
});

export function getRecipeForBlocker({ code, params = {} } = {}) {
  assertBlockerCode(code);
  if (isHardSafetyStop(code)) return null;
  return exactRecipes.get(code) || categoryRecipes.get(BLOCKER_CODES[code].category) || categoryRecipes.get("manual_review");
}

export function listRegisteredRecipeCodes() {
  return [...exactRecipes.keys()].sort();
}

export const __testing = Object.freeze({
  exactRecipes,
  categoryRecipes,
});
