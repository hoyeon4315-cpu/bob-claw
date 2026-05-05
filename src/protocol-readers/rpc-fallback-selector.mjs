// Pure deterministic RPC URL ordering for protocol readers.
//
// Inputs: candidate `rpcUrls`, recent `attempts` per URL (each
// `{ rpcUrl, observedAt, success }`), and an explicit `nowMs`. Output: the
// same URL set re-ordered so that endpoints with the highest recent success
// rate come first. The function never reads the clock or the filesystem so
// the order is reproducible from the same inputs and the same input order.
//
// Tie-breaks preserve the original `rpcUrls` order so downstream callers
// keep their declared preference (for example "primary first, preconf
// second") whenever recent reliability is equal.
//
// This module does not open RPC connections; it just decides which URL
// each reader should try first. The protocol readers (erc4626, aave-v3,
// pendle, beefy, ...) already iterate the returned list in order via
// their multi-RPC fallback Proxy, so swapping in this ordering is purely
// additive.

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_MIN_ATTEMPTS = 3;

function timestampMs(value) {
  if (value === null || value === undefined) return Number.NEGATIVE_INFINITY;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function uniqueRpcUrls(rpcUrls = []) {
  const seen = new Set();
  const ordered = [];
  for (const rawUrl of rpcUrls) {
    if (typeof rawUrl !== "string") continue;
    const url = rawUrl.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    ordered.push(url);
  }
  return ordered;
}

function tallyAttempts({ attempts, urls, nowMs, windowMs }) {
  const cutoff = Number.isFinite(nowMs) ? nowMs - windowMs : Number.NEGATIVE_INFINITY;
  const tallies = new Map();
  for (const url of urls) {
    tallies.set(url, { attemptCount: 0, successCount: 0, failureCount: 0 });
  }
  if (!Array.isArray(attempts)) return tallies;
  for (const attempt of attempts) {
    if (!attempt || typeof attempt.rpcUrl !== "string") continue;
    const url = attempt.rpcUrl.trim();
    if (!tallies.has(url)) continue;
    const observedMs = timestampMs(attempt.observedAt);
    if (Number.isFinite(observedMs) && observedMs < cutoff) continue;
    const tally = tallies.get(url);
    tally.attemptCount += 1;
    if (attempt.success === true) tally.successCount += 1;
    else if (attempt.success === false) tally.failureCount += 1;
  }
  return tallies;
}

function evidenceFor(url, tally, originalIndex, minAttempts) {
  const attemptCount = tally?.attemptCount ?? 0;
  const successCount = tally?.successCount ?? 0;
  const failureCount = tally?.failureCount ?? 0;
  const ratio = attemptCount > 0 ? successCount / attemptCount : null;
  // Endpoints with too few observations are treated as neutral so a single
  // bad call cannot push a primary URL behind every fallback.
  const evaluated = attemptCount >= minAttempts;
  const rankRatio = evaluated ? ratio : 1;
  return {
    rpcUrl: url,
    originalIndex,
    attemptCount,
    successCount,
    failureCount,
    successRatio: ratio,
    evaluated,
    rankRatio,
  };
}

export function orderRpcUrls({
  rpcUrls = [],
  attempts = [],
  nowMs = null,
  windowMs = DEFAULT_WINDOW_MS,
  minAttempts = DEFAULT_MIN_ATTEMPTS,
} = {}) {
  const urls = uniqueRpcUrls(rpcUrls);
  if (urls.length === 0) return { ordered: [], evidence: [] };
  const safeWindowMs = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_WINDOW_MS;
  const safeMinAttempts = Number.isFinite(minAttempts) && minAttempts > 0 ? Math.floor(minAttempts) : DEFAULT_MIN_ATTEMPTS;
  const tallies = tallyAttempts({ attempts, urls, nowMs, windowMs: safeWindowMs });
  const evidence = urls.map((url, index) => evidenceFor(url, tallies.get(url), index, safeMinAttempts));
  const ordered = [...evidence].sort((left, right) => {
    if (right.rankRatio !== left.rankRatio) return right.rankRatio - left.rankRatio;
    return left.originalIndex - right.originalIndex;
  });
  return {
    ordered: ordered.map((entry) => entry.rpcUrl),
    evidence,
  };
}

export const __test__ = {
  DEFAULT_WINDOW_MS,
  DEFAULT_MIN_ATTEMPTS,
  uniqueRpcUrls,
  tallyAttempts,
};
