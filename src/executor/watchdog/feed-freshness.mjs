// Feed freshness watchdog.
//
// Plan §5b.4 (T22). Sits alongside the heartbeat watchdog and enforces
// per-feed staleness budgets. The signer daemon and strategy dispatcher
// both call this; any feed older than its configured maxAgeMs forces a
// HALT verdict. Pure function — caller supplies current time and the
// feed manifest.
//
// Feed manifest shape:
//   [{ name, lastObservedAt, maxAgeMs, severity?, required? }]
//
// Typical feeds:
//   gas_snapshot        — 30 min budget; operator cron must refresh
//   btc_usd_oracle      — 10 min budget; pinned oracle snapshot
//   treasury_inventory  — 15 min budget; Capital Manager tick
//   liquidity_tvl       — 60 min budget; risk daemon input
//   heartbeat           —  1 min budget; executor liveness
//
// Missing feeds (never observed) are always stale. Optional feeds
// (required=false) still log age but do not flip ok=false.

const DEFAULT_SEVERITY = "HALT_STRATEGY";

const SEVERITY_RANK = Object.freeze({
  INFO: 0,
  WARN: 1,
  HALT_STRATEGY: 2,
  HALT_PROTOCOL: 3,
  UNWIND_ALL: 4,
  KILL_SWITCH: 5,
});

function parseTs(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function maxSeverity(a, b) {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

export function evaluateFeedFreshness({
  feeds = [],
  now = new Date().toISOString(),
} = {}) {
  const nowMs = parseTs(now);
  if (nowMs == null) {
    throw new TypeError("now must be a valid timestamp");
  }

  const results = [];
  let worstSeverity = null;
  let anyStale = false;

  for (const feed of feeds) {
    if (!feed || !feed.name) continue;
    const maxAgeMs = Number(feed.maxAgeMs);
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
      throw new TypeError(`feed ${feed.name}: maxAgeMs must be positive`);
    }
    const required = feed.required !== false;
    const severity = feed.severity || DEFAULT_SEVERITY;
    const observedMs = parseTs(feed.lastObservedAt);

    let status;
    let ageMs;
    let stale;
    if (observedMs == null) {
      status = "missing";
      ageMs = null;
      stale = true;
    } else {
      ageMs = nowMs - observedMs;
      if (ageMs < 0) {
        // Clock skew: treat future timestamps as 0 age but flag it.
        status = "skewed";
        stale = false;
      } else if (ageMs > maxAgeMs) {
        status = "stale";
        stale = true;
      } else {
        status = "fresh";
        stale = false;
      }
    }

    if (stale && required) {
      anyStale = true;
      worstSeverity = maxSeverity(worstSeverity, severity);
    }

    results.push(
      Object.freeze({
        name: feed.name,
        status,
        stale,
        required,
        ageMs,
        maxAgeMs,
        severity,
        lastObservedAt: feed.lastObservedAt ?? null,
      }),
    );
  }

  const ok = !anyStale;
  const action =
    !ok && (worstSeverity === "KILL_SWITCH" || worstSeverity === "UNWIND_ALL")
      ? "touch_kill_switch"
      : ok
        ? "continue"
        : "halt_new_entries";

  return Object.freeze({
    schemaVersion: 1,
    observedAt: now,
    ok,
    action,
    worstSeverity,
    staleCount: results.filter((r) => r.stale && r.required).length,
    feeds: Object.freeze(results),
  });
}

// Convenience helper: read the latest record timestamp out of a JSONL
// record list (or returns null). The caller reads the file; this is
// just the selector. Supports any of: observedAt, updatedAt, timestamp,
// ts, createdAt.
export function latestObservedAtOf(records = []) {
  if (!Array.isArray(records) || records.length === 0) return null;
  let best = null;
  for (const rec of records) {
    const candidate =
      parseTs(rec?.observedAt) ??
      parseTs(rec?.updatedAt) ??
      parseTs(rec?.timestamp) ??
      parseTs(rec?.ts) ??
      parseTs(rec?.createdAt);
    if (candidate != null && (best == null || candidate > best)) {
      best = candidate;
    }
  }
  return best == null ? null : new Date(best).toISOString();
}
