export function evaluateRoundtripEnforcer(intent = {}) {
  const kind = intent.kind ?? intent.intentType ?? "";
  if (kind !== "capital_deploy") {
    return { ok: true, blockers: [] };
  }

  const blockers = [];
  const unwindPlan =
    intent.unwindPlan ?? intent.metadata?.unwindPlan ?? null;

  if (
    !unwindPlan ||
    !Array.isArray(unwindPlan.steps) ||
    unwindPlan.steps.length === 0
  ) {
    blockers.push("missing_unwind_plan");
    return { ok: false, blockers };
  }

  const terminalStep = unwindPlan.steps[unwindPlan.steps.length - 1];
  const terminalChain =
    terminalStep?.chain ??
    terminalStep?.destinationChain ??
    unwindPlan.terminalChain ??
    null;

  if (terminalChain !== "bitcoin") {
    blockers.push("unwind_terminal_chain_not_bitcoin");
  }

  return {
    ok: blockers.length === 0,
    blockers,
  };
}
