/**
 * Pure dashboard slice that summarizes a promotion-pr-preview report into a
 * mobile-friendly shape. No I/O; input is the parsed JSON report object (or
 * null when no report has been produced yet).
 *
 * Invariants:
 *   - Output is frozen and deterministic given the input.
 *   - Never surfaces the suggestedDiff body (that belongs in the PR, not on
 *     the mobile dashboard which is public-visible).
 *   - Never mutates the input.
 *
 * Shape:
 * {
 *   available: boolean,              // was a report supplied
 *   generatedAt: string|null,
 *   lookbackDays: number|null,
 *   eligibleCount: number,
 *   blockedCount: number,
 *   eligible: [{ strategyId }],
 *   blocked:  [{ strategyId, firstBlocker, receiptsObserved, receiptsRequired }]
 * }
 */

export function buildPromotionSlice(report) {
  if (!report || typeof report !== "object") {
    return Object.freeze({
      available: false,
      generatedAt: null,
      lookbackDays: null,
      eligibleCount: 0,
      blockedCount: 0,
      eligible: Object.freeze([]),
      blocked: Object.freeze([]),
    });
  }

  const reports = Array.isArray(report.reports) ? report.reports : [];
  const requiredReceipts = Number(
    report.thresholds?.minSignerBackedReceipts ?? 0,
  );
  const eligible = [];
  const blocked = [];

  for (const r of reports) {
    if (!r || typeof r.strategyId !== "string") continue;
    if (r.eligible) {
      eligible.push(Object.freeze({ strategyId: r.strategyId }));
    } else {
      const firstBlockerRaw =
        Array.isArray(r.blockers) && r.blockers.length > 0
          ? r.blockers[0]
          : null;
      const firstBlocker =
        firstBlockerRaw && typeof firstBlockerRaw === "object"
          ? String(firstBlockerRaw.kind || "unknown")
          : firstBlockerRaw
            ? String(firstBlockerRaw)
            : "unknown";
      const receiptsObserved = Number(
        r.evidence?.signerBackedReceiptCount ?? 0,
      );
      blocked.push(
        Object.freeze({
          strategyId: r.strategyId,
          firstBlocker,
          receiptsObserved,
          receiptsRequired: requiredReceipts,
        }),
      );
    }
  }

  return Object.freeze({
    available: true,
    generatedAt:
      typeof report.generatedAt === "string" ? report.generatedAt : null,
    lookbackDays: Number.isFinite(report.lookbackDays)
      ? Number(report.lookbackDays)
      : null,
    eligibleCount: eligible.length,
    blockedCount: blocked.length,
    eligible: Object.freeze(eligible),
    blocked: Object.freeze(blocked),
  });
}
