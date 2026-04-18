import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { evaluateApprovalHygiene } from "./approval-hygiene.mjs";
import { evaluateCapCheck } from "./cap-check.mjs";
import { evaluateConsecutiveFailures } from "./consecutive-failures.mjs";
import { evaluateHealthFactorCheck } from "./hf-check.mjs";
import { checkKillSwitch } from "./kill-switch.mjs";
import { evaluateStaleQuote } from "./stale-quote.mjs";

export async function evaluateIntentPolicies({
  intent,
  auditRecords = [],
  activeBudgetUsd = null,
  now = new Date().toISOString(),
  killSwitchPath,
} = {}) {
  const strategyCaps = assertStrategyCaps(intent.strategyId);
  const results = [
    await checkKillSwitch({ killSwitchPath, now }),
    evaluateConsecutiveFailures({ intent, auditRecords, now }),
    evaluateCapCheck({ intent, strategyCaps, auditRecords, activeBudgetUsd, now }),
    evaluateHealthFactorCheck({ intent, strategyCaps, now }),
    evaluateStaleQuote({ intent, maxAgeMs: strategyCaps.intentTtlMs ?? undefined, now }),
    evaluateApprovalHygiene({ intent, now }),
  ];
  const blockers = results.flatMap((item) => item.blockers || []);
  return {
    observedAt: now,
    strategyId: intent.strategyId,
    decision: blockers.length > 0 ? "BLOCK" : "ALLOW",
    blockers: [...new Set(blockers)],
    results,
    strategyCaps,
  };
}
