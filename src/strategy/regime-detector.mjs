/**
 * Regime-change detector based on Mayer Multiple.
 *
 * AGENTS.md requires at least one regime change in the sample window before
 * a strategy may be promoted. Regime is classified deterministically from
 * Mayer Multiple = spotPrice / 200-day moving average.
 *
 * Classification thresholds (Mayer Multiple cut-offs):
 *   bear       : MM < 1.0       — spot below 200d MA
 *   neutral    : 1.0 <= MM < 2.4
 *   bull_peak  : MM >= 2.4
 *
 * Matches the policy ratio multipliers in src/config/payback.mjs (bear 1.2,
 * neutral 1.0, bull_peak 0.7). This module does not import payback config;
 * the classification itself is a pure function over price history.
 *
 * Zero I/O. All outputs frozen.
 */

export const REGIME_THRESHOLDS = Object.freeze({
  bearCeiling: 1.0,       // MM < 1.0 => bear
  bullPeakFloor: 2.4,     // MM >= 2.4 => bull_peak; [1.0, 2.4) => neutral
  maWindowDays: 200,
});

const DAY_MS = 24 * 60 * 60 * 1000;

export function classifyRegime(mayerMultiple) {
  if (!Number.isFinite(mayerMultiple) || mayerMultiple <= 0) {
    return "unknown";
  }
  if (mayerMultiple < REGIME_THRESHOLDS.bearCeiling) return "bear";
  if (mayerMultiple >= REGIME_THRESHOLDS.bullPeakFloor) return "bull_peak";
  return "neutral";
}

/**
 * Given a chronologically-ordered price series, compute Mayer Multiple and
 * regime at each point. Points where the 200d MA window isn't full are
 * classified as "unknown".
 *
 * Input: [{ tsMs: number, priceUsd: number }, ...]
 * Output: frozen array of { tsMs, priceUsd, ma200, mayerMultiple, regime }
 */
export function annotateRegimeSeries(priceSeries, {
  maWindowDays = REGIME_THRESHOLDS.maWindowDays,
} = {}) {
  if (!Array.isArray(priceSeries)) {
    throw new TypeError("priceSeries must be an array");
  }
  const sorted = priceSeries
    .filter((p) => p && Number.isFinite(p.tsMs) && Number.isFinite(p.priceUsd) && p.priceUsd > 0)
    .slice()
    .sort((a, b) => a.tsMs - b.tsMs);

  const windowMs = maWindowDays * DAY_MS;
  const out = [];

  // Two-pointer rolling window over time (not count-based, so irregular
  // sampling still produces a time-weighted moving average approximation).
  let windowStart = 0;
  let windowSum = 0;
  let windowCount = 0;

  for (let i = 0; i < sorted.length; i += 1) {
    windowSum += sorted[i].priceUsd;
    windowCount += 1;
    const cutoffMs = sorted[i].tsMs - windowMs;
    while (windowStart < i && sorted[windowStart].tsMs < cutoffMs) {
      windowSum -= sorted[windowStart].priceUsd;
      windowCount -= 1;
      windowStart += 1;
    }

    const ma200 = windowCount > 0 ? windowSum / windowCount : 0;
    const spanMs = sorted[i].tsMs - sorted[windowStart].tsMs;
    // Require the window to cover at least 90% of maWindowDays before we
    // trust the MA. Otherwise classification is "unknown".
    const windowFull = spanMs >= windowMs * 0.9;
    const mm = windowFull && ma200 > 0 ? sorted[i].priceUsd / ma200 : NaN;
    const regime = windowFull ? classifyRegime(mm) : "unknown";

    out.push(Object.freeze({
      tsMs: sorted[i].tsMs,
      priceUsd: sorted[i].priceUsd,
      ma200: Number(ma200.toFixed(2)),
      mayerMultiple: Number.isFinite(mm) ? Number(mm.toFixed(4)) : null,
      regime,
    }));
  }

  return Object.freeze(out);
}

/**
 * List regime-change events in an annotated series. A change is recorded
 * whenever the regime label differs from the previous non-"unknown" label.
 * Transitions from/into "unknown" are NOT recorded as changes.
 *
 * Output: frozen array of { fromRegime, toRegime, tsMs }
 */
export function extractRegimeChanges(annotated) {
  if (!Array.isArray(annotated)) {
    throw new TypeError("annotated must be an array");
  }
  const changes = [];
  let lastKnown = null;
  for (const p of annotated) {
    if (p.regime === "unknown") continue;
    if (lastKnown !== null && lastKnown !== p.regime) {
      changes.push(Object.freeze({
        fromRegime: lastKnown,
        toRegime: p.regime,
        tsMs: p.tsMs,
      }));
    }
    lastKnown = p.regime;
  }
  return Object.freeze(changes);
}

/**
 * True iff at least one regime change (excluding transitions from/into
 * "unknown") occurs within [startMs, endMs). The annotated series may
 * extend beyond the window; only changes whose tsMs falls inside the
 * window count.
 */
export function hasRegimeChangeInWindow({ annotated, startMs, endMs }) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new TypeError("startMs < endMs required");
  }
  const changes = extractRegimeChanges(annotated);
  for (const c of changes) {
    if (c.tsMs >= startMs && c.tsMs < endMs) return true;
  }
  return false;
}

/**
 * Convenience: given raw price series + a window, return a frozen summary.
 *
 * Output:
 * {
 *   startMs, endMs,
 *   pointsInWindow, regimes: { bear, neutral, bull_peak, unknown },
 *   changes: [...],
 *   hasChange: boolean
 * }
 */
export function summarizeRegimeWindow({
  priceSeries,
  startMs,
  endMs,
  maWindowDays = REGIME_THRESHOLDS.maWindowDays,
}) {
  const annotated = annotateRegimeSeries(priceSeries, { maWindowDays });
  const inWindow = annotated.filter((p) => p.tsMs >= startMs && p.tsMs < endMs);
  const counts = { bear: 0, neutral: 0, bull_peak: 0, unknown: 0 };
  for (const p of inWindow) {
    counts[p.regime] = (counts[p.regime] || 0) + 1;
  }
  const changes = extractRegimeChanges(annotated).filter(
    (c) => c.tsMs >= startMs && c.tsMs < endMs,
  );
  return Object.freeze({
    startMs,
    endMs,
    pointsInWindow: inWindow.length,
    regimes: Object.freeze(counts),
    changes,
    hasChange: changes.length > 0,
  });
}
