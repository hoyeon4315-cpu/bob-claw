// Concentration guard. Wraps src/config/diversification.mjs as a risk daemon.
// An intent that would violate per-strategy/chain/protocol share or HHI is
// rejected before reaching the signer.

import { SEVERITY, makeVerdict } from "./types.mjs";
import {
  DIVERSIFICATION_POLICY,
  canAcceptNewAllocation,
} from "../../config/diversification.mjs";

export function evaluateConcentrationGuard({
  currentAllocations,
  candidate,
  policy = DIVERSIFICATION_POLICY,
} = {}) {
  if (!candidate) {
    return makeVerdict({
      moduleId: "concentration-guard",
      ok: false,
      severity: SEVERITY.HALT_STRATEGY,
      action: "reject_intent_missing_candidate",
      violations: [{ kind: "missing_candidate" }],
    });
  }
  const result = canAcceptNewAllocation(
    currentAllocations || {},
    candidate,
    policy,
  );
  const ok = result.accepted;
  return makeVerdict({
    moduleId: `concentration-guard:${candidate.strategyId || "unknown"}`,
    ok,
    severity: ok ? SEVERITY.INFO : SEVERITY.HALT_STRATEGY,
    action: ok ? "allow" : "reject_intent",
    violations: result.verdict.violations,
    details: {
      hhi: result.verdict.hhi,
      activeStrategies: result.verdict.activeStrategies,
      projectedAllocations: result.projectedAllocations,
    },
  });
}
