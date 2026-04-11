export function routeArgs(address, route) {
  return [`--address=${address}`, `--route-key=${route.routeKey}`, `--amount=${route.amount}`];
}

export function activeRoute(step, fallbackRoute = null) {
  return step?.route || fallbackRoute || null;
}

export function scoringArgsForStep(step, fallbackRoute = null) {
  const route = activeRoute(step, fallbackRoute);
  if (!route) return ["--write"];
  if (step?.decision === "RUN_EXACT_GAS" || step?.decision === "RERUN_SCORING") {
    return ["--write", `--route-key=${route.routeKey}`, `--amount=${route.amount}`];
  }
  return ["--write"];
}

export function summarizeStep(step) {
  return {
    decision: step?.decision || null,
    headline: step?.headline || null,
    routeLabel: step?.route?.label || null,
    routeKey: step?.route?.routeKey || null,
    amount: step?.route?.amount || null,
    reasons: step?.reasons || [],
  };
}

export function buildAdvanceSummary({ address, initialStep, afterWalletCheckStep = null, finalStep = null, actions = [] }) {
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    address: address || null,
    actionCount: actions.length,
    actions,
    initial: summarizeStep(initialStep),
    afterWalletCheck: afterWalletCheckStep ? summarizeStep(afterWalletCheckStep) : null,
    final: finalStep ? summarizeStep(finalStep) : null,
  };
}
