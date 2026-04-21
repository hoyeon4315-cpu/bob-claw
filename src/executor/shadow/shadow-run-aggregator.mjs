// End-to-end shadow run aggregator.
//
// Plan §5b.5 T17. Every new adapter must run for ≥7 days in shadow mode
// (cap=0, no signed broadcast) before it can enter the canary ladder
// (T21). The audit log collects per-tick intents the policy engine
// evaluated; this module folds them into a readiness verdict per
// adapter so an operator can promote with confidence.
//
// Pure function. No I/O. Caller reads logs/signer-audit.jsonl (or any
// equivalent shadow audit store), filters to shadow entries, and passes
// them in. Module does no file access.
//
// Entry shape (duck-typed — extra fields ignored):
//   {
//     adapterId,        // string — strategy id
//     observedAt,       // ISO or ms
//     mode,             // "shadow" | "canary" | "live" — shadow only counted
//     policyVerdict,    // "approved" | "rejected" | "errored"
//     rejectionReason,  // string (when rejected)
//     plannedNetSats,   // int — simulated expected net after cost
//     plannedCostSats,  // int — estimated round-trip cost
//     plannedYieldSats, // int — estimated gross yield
//   }
//
// Readiness rules (all must hold for verdict="ready"):
//   - duration ≥ minDurationMs                (default 7d)
//   - approved count ≥ minApprovedCount       (default 100)
//   - approved-rate ≥ minApprovedRate         (default 0.70)
//   - mean plannedNetSats > 0                 (positive shadow edge)
//   - zero errored entries                    (policy engine must be clean)
//   - rejectionReason histogram: no single reason > maxSingleReasonRate
//     (default 0.60 of all rejections — catches a systemic fault)

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_THRESHOLDS = Object.freeze({
  minDurationMs: 7 * DAY_MS,
  minApprovedCount: 100,
  minApprovedRate: 0.7,
  minMeanNetSats: 1,
  maxSingleReasonRate: 0.6,
});

function parseTs(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

function num(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

function incr(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function histogramAsObject(map) {
  const out = {};
  for (const [k, v] of map.entries()) out[k] = v;
  return out;
}

export function aggregateShadowRun({
  entries = [],
  adapterId = null,
  now = new Date().toISOString(),
  thresholds = DEFAULT_THRESHOLDS,
} = {}) {
  const nowMs = parseTs(now);
  if (nowMs == null) {
    throw new TypeError("now must be a valid timestamp");
  }
  const t = Object.freeze({ ...DEFAULT_THRESHOLDS, ...thresholds });

  // Group per adapter.
  const byAdapter = new Map();
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.mode !== "shadow") continue;
    if (!raw.adapterId) continue;
    if (adapterId && raw.adapterId !== adapterId) continue;
    let bucket = byAdapter.get(raw.adapterId);
    if (!bucket) {
      bucket = {
        adapterId: raw.adapterId,
        firstTs: null,
        lastTs: null,
        approved: 0,
        rejected: 0,
        errored: 0,
        netSatsSum: 0,
        yieldSatsSum: 0,
        costSatsSum: 0,
        rejectionHist: new Map(),
      };
      byAdapter.set(raw.adapterId, bucket);
    }
    const ts = parseTs(raw.observedAt);
    if (ts != null) {
      if (bucket.firstTs == null || ts < bucket.firstTs) bucket.firstTs = ts;
      if (bucket.lastTs == null || ts > bucket.lastTs) bucket.lastTs = ts;
    }
    const verdict = raw.policyVerdict;
    if (verdict === "approved") {
      bucket.approved += 1;
      bucket.netSatsSum += num(raw.plannedNetSats);
      bucket.yieldSatsSum += num(raw.plannedYieldSats);
      bucket.costSatsSum += num(raw.plannedCostSats);
    } else if (verdict === "rejected") {
      bucket.rejected += 1;
      incr(bucket.rejectionHist, raw.rejectionReason || "unknown");
    } else if (verdict === "errored") {
      bucket.errored += 1;
    }
  }

  const reports = [];
  for (const b of byAdapter.values()) {
    const total = b.approved + b.rejected + b.errored;
    const approvedRate = total > 0 ? b.approved / total : 0;
    const durationMs =
      b.firstTs != null && b.lastTs != null ? b.lastTs - b.firstTs : 0;
    const meanNetSats = b.approved > 0 ? b.netSatsSum / b.approved : 0;

    // Systemic rejection detector.
    let topRejection = null;
    let topRejectionRate = 0;
    if (b.rejected > 0) {
      for (const [reason, count] of b.rejectionHist.entries()) {
        const rate = count / b.rejected;
        if (rate > topRejectionRate) {
          topRejectionRate = rate;
          topRejection = reason;
        }
      }
    }

    const blockers = [];
    if (durationMs < t.minDurationMs) {
      blockers.push({
        kind: "duration_insufficient",
        detail: {
          elapsedMs: durationMs,
          elapsedDays: Number((durationMs / DAY_MS).toFixed(2)),
          requiredMs: t.minDurationMs,
        },
      });
    }
    if (b.approved < t.minApprovedCount) {
      blockers.push({
        kind: "approved_count_insufficient",
        detail: { approved: b.approved, required: t.minApprovedCount },
      });
    }
    if (approvedRate < t.minApprovedRate) {
      blockers.push({
        kind: "approved_rate_low",
        detail: {
          approvedRate: Number(approvedRate.toFixed(4)),
          required: t.minApprovedRate,
        },
      });
    }
    if (meanNetSats < t.minMeanNetSats) {
      blockers.push({
        kind: "mean_net_non_positive",
        detail: { meanNetSats: Math.round(meanNetSats) },
      });
    }
    if (b.errored > 0) {
      blockers.push({
        kind: "policy_errors_present",
        detail: { errored: b.errored },
      });
    }
    if (topRejection && topRejectionRate > t.maxSingleReasonRate) {
      blockers.push({
        kind: "systemic_rejection_reason",
        detail: {
          reason: topRejection,
          rate: Number(topRejectionRate.toFixed(4)),
          limit: t.maxSingleReasonRate,
        },
      });
    }

    const verdict = blockers.length === 0 ? "ready" : "not_ready";
    reports.push(
      Object.freeze({
        adapterId: b.adapterId,
        verdict,
        action: verdict === "ready" ? "promote_to_canary_1" : "continue_shadow",
        firstObservedAt:
          b.firstTs != null ? new Date(b.firstTs).toISOString() : null,
        lastObservedAt:
          b.lastTs != null ? new Date(b.lastTs).toISOString() : null,
        durationMs,
        counts: Object.freeze({
          approved: b.approved,
          rejected: b.rejected,
          errored: b.errored,
          total,
        }),
        approvedRate: Number(approvedRate.toFixed(4)),
        meanNetSats: Math.round(meanNetSats),
        totals: Object.freeze({
          netSats: b.netSatsSum,
          yieldSats: b.yieldSatsSum,
          costSats: b.costSatsSum,
        }),
        topRejection: topRejection
          ? Object.freeze({
              reason: topRejection,
              rate: Number(topRejectionRate.toFixed(4)),
            })
          : null,
        rejectionHistogram: Object.freeze(histogramAsObject(b.rejectionHist)),
        blockers: Object.freeze(blockers.map(Object.freeze)),
      }),
    );
  }

  reports.sort((a, b) => a.adapterId.localeCompare(b.adapterId));

  const readyCount = reports.filter((r) => r.verdict === "ready").length;
  return Object.freeze({
    schemaVersion: 1,
    observedAt: now,
    adapterCount: reports.length,
    readyCount,
    notReadyCount: reports.length - readyCount,
    reports: Object.freeze(reports),
  });
}

export { DEFAULT_THRESHOLDS };
