import { BLOCKER_CODES, isHardSafetyStop } from "../policy/blocker-codes.mjs";
import { getRecipeForBlocker } from "./recipes.mjs";
import { buildPendingDispatchEntry } from "./dispatch-tracker.mjs";

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function recipeRoi(recipe, params, context) {
  if (!recipe || typeof recipe.expectedDailyUsdOnResolve !== "function") return null;
  return finiteNumber(recipe.expectedDailyUsdOnResolve(params, context));
}

function recipeRequiresExternalDeposit(recipe, code, params = {}) {
  if (params.requiresExternalDeposit === true) return true;
  if (typeof recipe?.requiresExternalDeposit === "function") return recipe.requiresExternalDeposit(params);
  if (recipe?.requiresExternalDeposit === true) return true;
  return BLOCKER_CODES[code]?.requiresExternalDeposit === true;
}

function dependenciesBlocked(recipe, circuitState = {}, circuitAllows = null) {
  if (!recipe?.dependencies?.length || typeof circuitAllows !== "function") return null;
  for (const dep of recipe.dependencies) {
    const verdict = circuitAllows(circuitState, dep);
    if (verdict?.allowed === false) return dep;
  }
  return null;
}

function preDispatchBlocked(action, context = {}) {
  if (action?.type !== "operational_intent") return null;
  if (context.operatorHold === true) return "operator_hold";
  if (context.pausedByAutoKill === true) return "paused_by_auto_kill";
  if (Array.isArray(context.positionActions) && context.positionActions.some((item) => item?.type === "exit" || item?.type === "unwind")) {
    return "position_exiting";
  }
  if (context.readyForLiveBroadcast === false) return "readiness_guard_blocked";
  return null;
}

export async function planProofAcquisition({
  strategyId = null,
  code,
  params = {},
  paramsKey,
  observedAt = new Date().toISOString(),
  context = {},
  attemptCount = 0,
  mode = "preview",
  executeAction = async () => ({ ok: true }),
  circuitState = {},
  circuitAllows = null,
} = {}) {
  if (isHardSafetyStop(code)) {
    return {
      status: "hard_safety_stop",
      actions: [],
      nextRetryAt: null,
      attemptCountUpdate: "unchanged",
      unresolvedReason: code,
      expectedDailyUsdOnResolve: null,
      requiresExternalDeposit: false,
    };
  }

  const recipe = getRecipeForBlocker({ code, params });
  if (!recipe) {
    return {
      status: "manual_review_required",
      actions: [],
      nextRetryAt: null,
      attemptCountUpdate: "unchanged",
      unresolvedReason: "recipe_missing",
      expectedDailyUsdOnResolve: null,
      requiresExternalDeposit: false,
    };
  }
  const expectedDailyUsdOnResolve = recipeRoi(recipe, params, context);
  const requiresExternalDeposit = recipeRequiresExternalDeposit(recipe, code, params);
  const depBlocked = dependenciesBlocked(recipe, circuitState, circuitAllows);
  if (depBlocked) {
    return {
      status: "skipped_circuit_open",
      actions: [],
      nextRetryAt: null,
      attemptCountUpdate: "unchanged",
      unresolvedReason: `circuit_open:${depBlocked}`,
      expectedDailyUsdOnResolve,
      requiresExternalDeposit,
    };
  }
  const action = recipe.build({ code, params, context });
  if (action?.type === "queue_entry") {
    return {
      status: "manual_review_required",
      actions: [action],
      nextRetryAt: null,
      attemptCountUpdate: "unchanged",
      unresolvedReason: action.reason || recipe.kind,
      expectedDailyUsdOnResolve,
      requiresExternalDeposit,
    };
  }
  if (recipe.kind === "economic_no_go") {
    return {
      status: "proof_not_applicable",
      actions: [action],
      nextRetryAt: null,
      attemptCountUpdate: "unchanged",
      unresolvedReason: "economic_no_go",
      expectedDailyUsdOnResolve,
      requiresExternalDeposit,
    };
  }
  if (recipe.kind === "manual_operator_review" || recipe.kind === "code_required") {
    return {
      status: "manual_review_required",
      actions: [action],
      nextRetryAt: null,
      attemptCountUpdate: "unchanged",
      unresolvedReason: recipe.kind,
      expectedDailyUsdOnResolve,
      requiresExternalDeposit,
    };
  }
  if (recipe.kind === "time_bounded_wait") {
    return {
      status: "proof_not_applicable",
      actions: [action],
      nextRetryAt: action.nextRetryAt || null,
      attemptCountUpdate: "unchanged",
      unresolvedReason: "cooldown",
      expectedDailyUsdOnResolve,
      requiresExternalDeposit,
    };
  }

  const hardPreDispatch = preDispatchBlocked(action, context);
  if (hardPreDispatch) {
    return {
      status: "hard_safety_stop",
      actions: [action],
      nextRetryAt: null,
      attemptCountUpdate: "unchanged",
      unresolvedReason: hardPreDispatch,
      expectedDailyUsdOnResolve,
      requiresExternalDeposit,
    };
  }

  if (mode === "preview" || mode === "dry-run-idle") {
    return {
      status: "proof_still_missing",
      actions: [action],
      nextRetryAt: null,
      attemptCountUpdate: "unchanged",
      unresolvedReason: mode === "preview" ? "preview_only" : "dry_run_idle",
      expectedDailyUsdOnResolve,
      requiresExternalDeposit,
    };
  }

  const result = await executeAction(action, { strategyId, code, params, paramsKey, attemptCount });
  if (action.receiptRequired || action.type === "operational_intent") {
    const pending = buildPendingDispatchEntry({ strategyId, code, paramsKey, action, observedAt });
    return {
      status: "pending_receipt",
      actions: [{ ...action, intentHash: pending.intentHash, dispatch: pending, executionResult: result }],
      nextRetryAt: null,
      attemptCountUpdate: "unchanged",
      unresolvedReason: "awaiting_receipt",
      expectedDailyUsdOnResolve,
      requiresExternalDeposit,
    };
  }

  if (result?.ok === true) {
    return {
      status: "proof_refreshed",
      actions: [{ ...action, executionResult: result }],
      nextRetryAt: null,
      attemptCountUpdate: "reset",
      unresolvedReason: null,
      expectedDailyUsdOnResolve,
      requiresExternalDeposit,
    };
  }

  return {
    status: "proof_still_missing",
    actions: [{ ...action, executionResult: result }],
    nextRetryAt: null,
    attemptCountUpdate: "increment",
    unresolvedReason: result?.error || "attempt_failed",
    expectedDailyUsdOnResolve,
    requiresExternalDeposit,
  };
}
