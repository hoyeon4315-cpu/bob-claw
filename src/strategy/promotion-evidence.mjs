// Deterministic evidence-→-promotion gate.
//
// Pure function. Reads strategy receipts (already collected by the
// existing receipt ingestor) and decides whether a strategy has accrued
// enough signer-backed live evidence to be eligible for an
// `autoExecute: true` cap-flip diff.
//
// Caps are still code, not env vars (AGENTS.md). This module never
// rewrites strategy-caps.mjs and never opens a PR. It only emits a
// machine-readable verdict and a human-readable diff hint that the
// operator must commit by hand. The bash side runs the suggestion
// through `promotion-pr-preview.mjs`.
//
// Promotion thresholds are deliberately conservative. They MUST be
// changed by a committed diff to this file — never by env or runtime.

// Operator fast-track policy (committed-diff change, AGENTS.md #5):
// thresholds are deliberately set to the minimum statistically-defensible
// floor so the first dust-canary cycle can promote in 3-4 days instead of
// 14. Trade-offs are documented in the canary plan; once the wrapped-BTC
// loop has 8 receipts, raise back via another committed diff.
export const PROMOTION_THRESHOLDS = Object.freeze({
  // Minimum signer-backed live receipts in the lookback window.
  // Was 8; lowered to 2 for first dust-canary promotion. With dust caps
  // (perTradeCapUsd: 1) the realized risk per receipt is bounded at $1.
  minSignerBackedReceipts: 2,
  // Minimum consecutive successful receipts immediately preceding `now`.
  // Was 5; lowered to 1 — single immediate prior success required.
  minConsecutiveSuccess: 1,
  // Minimum cumulative realized BTC profit (sats) over the lookback.
  // Set to 0 for dust-canary execution evidence (profit not required).
  minCumulativeProfitSats: 0,
  // Maximum tolerated failures over the lookback window. Stays at 1.
  maxFailureCount: 1,
  // Lookback window — was 14d; 3d to align with dust-canary cadence.
  defaultLookbackDays: 3,
  // Minimum payback round-trip efficiency (gross−cost)/gross. Stays at
  // AGENTS.md target band for `roundTripEfficiency`.
  minRoundTripEfficiency: 0.9,
});

// Strict standard (pre-fast-track values) preserved for callers that want
// to evaluate against the original policy — tests, reports comparing
// strict vs fast-track, and the future "raise thresholds back" PR.
export const PROMOTION_THRESHOLDS_STRICT = Object.freeze({
  minSignerBackedReceipts: 8,
  minConsecutiveSuccess: 5,
  minCumulativeProfitSats: 5_000,
  maxFailureCount: 1,
  defaultLookbackDays: 14,
  minRoundTripEfficiency: 0.9,
});

function withinLookback(receipt, nowMs, lookbackDays) {
  if (!Number.isFinite(receipt.tsMs)) return false;
  const cutoff = nowMs - lookbackDays * 24 * 60 * 60 * 1000;
  return receipt.tsMs >= cutoff;
}

function isSignerBacked(r) {
  return r.source === "signer" && Boolean(r.txHash);
}

function isSuccess(r) {
  return r.outcome === "success";
}

export function evaluatePromotionEvidence({
  strategyId,
  receipts,
  nowMs,
  thresholds = PROMOTION_THRESHOLDS,
  lookbackDays = PROMOTION_THRESHOLDS.defaultLookbackDays,
  // Optional backtest / market-context evidence. When provided, a failing
  // report becomes an additional blocker; when absent, it is silently
  // skipped (backwards compatible with prior callers).
  //
  // walkForwardReport: output of evaluateWalkForwardCv(). Must expose
  //   `.passes: boolean` and `.blockers: string[]`.
  // regimeWindow: output of summarizeRegimeWindow(). Must expose
  //   `.hasChange: boolean`.
  walkForwardReport = null,
  regimeWindow = null,
} = {}) {
  if (typeof strategyId !== "string" || !strategyId) {
    throw new TypeError("strategyId required");
  }
  if (!Array.isArray(receipts)) throw new TypeError("receipts array required");
  if (!Number.isFinite(nowMs)) throw new TypeError("nowMs required");

  const filtered = receipts
    .filter((r) => r && r.strategyId === strategyId)
    .filter((r) => withinLookback(r, nowMs, lookbackDays))
    .sort((a, b) => a.tsMs - b.tsMs);

  const signerBacked = filtered.filter(isSignerBacked);
  const successes = signerBacked.filter(isSuccess);
  const failures = signerBacked.filter((r) => !isSuccess(r));

  let consecutive = 0;
  for (let i = signerBacked.length - 1; i >= 0; i -= 1) {
    if (isSuccess(signerBacked[i])) consecutive += 1;
    else break;
  }

  const cumulativeProfitSats = successes
    .map((r) => Number(r.realizedProfitSats || 0))
    .filter(Number.isFinite)
    .reduce((a, b) => a + b, 0);

  const roundTripCostsSats = successes
    .map((r) => Number(r.roundTripCostSats || 0))
    .filter(Number.isFinite)
    .reduce((a, b) => a + b, 0);

  const grossProfitSats = cumulativeProfitSats + roundTripCostsSats;
  const roundTripEfficiency = grossProfitSats > 0
    ? (grossProfitSats - roundTripCostsSats) / grossProfitSats
    : 0;

  const blockers = [];
  if (signerBacked.length < thresholds.minSignerBackedReceipts) {
    blockers.push({
      kind: "insufficient_signer_backed_receipts",
      have: signerBacked.length,
      need: thresholds.minSignerBackedReceipts,
    });
  }
  if (consecutive < thresholds.minConsecutiveSuccess) {
    blockers.push({
      kind: "insufficient_consecutive_success",
      have: consecutive,
      need: thresholds.minConsecutiveSuccess,
    });
  }
  if (failures.length > thresholds.maxFailureCount) {
    blockers.push({
      kind: "too_many_failures",
      have: failures.length,
      max: thresholds.maxFailureCount,
    });
  }
  if (cumulativeProfitSats < thresholds.minCumulativeProfitSats) {
    blockers.push({
      kind: "insufficient_cumulative_profit_sats",
      have: cumulativeProfitSats,
      need: thresholds.minCumulativeProfitSats,
    });
  }
  if (
    grossProfitSats > 0
    && roundTripEfficiency < thresholds.minRoundTripEfficiency
  ) {
    blockers.push({
      kind: "round_trip_efficiency_below_target",
      have: Number(roundTripEfficiency.toFixed(4)),
      need: thresholds.minRoundTripEfficiency,
    });
  }

  if (walkForwardReport !== null && walkForwardReport !== undefined) {
    if (typeof walkForwardReport !== "object") {
      throw new TypeError("walkForwardReport must be an object");
    }
    if (walkForwardReport.passes !== true) {
      blockers.push({
        kind: "walk_forward_cv_failed",
        cvBlockers: Object.freeze(
          Array.isArray(walkForwardReport.blockers)
            ? [...walkForwardReport.blockers]
            : [],
        ),
      });
    }
  }

  if (regimeWindow !== null && regimeWindow !== undefined) {
    if (typeof regimeWindow !== "object") {
      throw new TypeError("regimeWindow must be an object");
    }
    if (regimeWindow.hasChange !== true) {
      blockers.push({
        kind: "no_regime_change_in_sample_window",
      });
    }
  }

  const eligible = blockers.length === 0;

  return Object.freeze({
    strategyId,
    eligible,
    evidence: Object.freeze({
      lookbackDays,
      signerBackedReceiptCount: signerBacked.length,
      consecutiveSuccess: consecutive,
      failureCount: failures.length,
      cumulativeProfitSats,
      grossProfitSats,
      roundTripCostsSats,
      roundTripEfficiency: Number(roundTripEfficiency.toFixed(4)),
      walkForwardApplied: walkForwardReport !== null && walkForwardReport !== undefined,
      walkForwardPasses: walkForwardReport ? walkForwardReport.passes === true : null,
      regimeWindowApplied: regimeWindow !== null && regimeWindow !== undefined,
      regimeWindowHasChange: regimeWindow ? regimeWindow.hasChange === true : null,
    }),
    blockers: Object.freeze(blockers),
    suggestedDiff: eligible ? buildAutoExecDiffHint(strategyId) : null,
  });
}

export function buildAutoExecDiffHint(strategyId) {
  // Returns a *hint*, not an executed patch. Operator commits by hand
  // after reviewing. AGENTS.md: caps are code, change via committed diff.
  return Object.freeze({
    file: "src/config/strategy-caps.mjs",
    strategyId,
    change: "autoExecute: false → autoExecute: true",
    operatorAction:
      "Edit src/config/strategy-caps.mjs, flip autoExecute on the named strategy, "
      + "run `npm test`, commit on its own PR with the supporting evidence JSON in the body.",
  });
}

export function summarizePromotionEvidence(reports) {
  if (!Array.isArray(reports)) throw new TypeError("reports array required");
  const eligible = reports.filter((r) => r.eligible);
  const blocked = reports.filter((r) => !r.eligible);
  return Object.freeze({
    eligibleCount: eligible.length,
    blockedCount: blocked.length,
    eligible: Object.freeze(eligible.map((r) => r.strategyId)),
    blocked: Object.freeze(blocked.map((r) => ({
      strategyId: r.strategyId,
      blockerCount: r.blockers.length,
      firstBlocker: r.blockers[0]?.kind || null,
    }))),
  });
}
