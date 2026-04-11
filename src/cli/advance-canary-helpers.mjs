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
