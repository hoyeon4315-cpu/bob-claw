import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_JSX = readFileSync(
  join(HERE, "..", "dashboard", "public", "data.jsx"),
  "utf8"
);

test("dashboard data source builds holdings/capital before strategy mapping", () => {
  const holdingsIdx = DATA_JSX.indexOf("const HOLDINGS =");
  const capitalIdx = DATA_JSX.indexOf("const CAPITAL = buildCapitalMaps(HOLDINGS);");
  const strategiesIdx = DATA_JSX.indexOf("const STRATEGIES = Array.from(allIds).map");
  assert.notEqual(holdingsIdx, -1, "missing HOLDINGS block");
  assert.notEqual(capitalIdx, -1, "missing CAPITAL block");
  assert.notEqual(strategiesIdx, -1, "missing STRATEGIES map");
  assert.ok(holdingsIdx < strategiesIdx, "HOLDINGS must exist before STRATEGIES mapping");
  assert.ok(capitalIdx < strategiesIdx, "CAPITAL must exist before STRATEGIES mapping");
});

test("dashboard data source estimates yield for live positions instead of forcing zero", () => {
  assert.match(DATA_JSX, /function estimateYieldUsd\(/);
  assert.match(DATA_JSX, /const estimatedYieldUsd = estimateYieldUsd\(/);
  assert.match(DATA_JSX, /const allocatedSats = Number\(parity\?\.scoredAllocation\?\.allocatedSats \?\? 0\)/);
  assert.match(DATA_JSX, /const effectiveCapUsd = Number\.isFinite\(s\.capUsd\) && s\.capUsd > 0/);
  assert.match(DATA_JSX, /capUsd: effectiveCapUsd/);
  assert.match(DATA_JSX, /actualProtocolCapitalUsd: effectiveProtocolCapitalUsd/);
  assert.match(DATA_JSX, /const apyPct = Number\.isFinite\(m\.aprPct\)/);
  assert.match(DATA_JSX, /yieldBasis: realizedYieldUsd > 0 \? 'realized' : \(estimatedYieldUsd > 0 \? 'estimated' : null\)/);
  assert.match(DATA_JSX, /const realizedEvidenceCostUsd = pnl\?\.realized\?\.evidenceCostUsd/);
  assert.match(DATA_JSX, /const realizedTotalUsd = pnl\?\.realized\?\.totalValueUsd/);
  assert.match(DATA_JSX, /const FLOW_METRICS = \{/);
  assert.match(DATA_JSX, /realizedStrategyUsd: Number\.isFinite\(realizedUsd\) \? realizedUsd : null/);
  assert.match(DATA_JSX, /realizedEvidenceCostUsd: Number\.isFinite\(realizedEvidenceCostUsd\) \? realizedEvidenceCostUsd : null/);
  assert.match(DATA_JSX, /realizedByKind: Array\.isArray\(realizedBreakdown\?\.byKind\) \? realizedBreakdown\.byKind : \[\]/);
  assert.doesNotMatch(DATA_JSX, /earnedUsd:\s*0,\s*\n\s*apyPct:/);
});

test("dashboard data source refreshes on polling and window focus recovery", () => {
  assert.match(DATA_JSX, /async function refreshDashboardData\(\{ dispatch = true, payload = null \} = \{\}\)/);
  assert.match(DATA_JSX, /if \(!window\._DASHBOARD_REFRESH_IN_FLIGHT\)/);
  assert.match(DATA_JSX, /window\._DASHBOARD_REFRESH_IN_FLIGHT = \(async \(\) => \{/);
  assert.match(DATA_JSX, /return window\._DASHBOARD_REFRESH_IN_FLIGHT;/);
  assert.match(DATA_JSX, /function setupDashboardRefreshHooks\(\)/);
  assert.match(DATA_JSX, /window\.addEventListener\('focus', refreshVisibleData\)/);
  assert.match(DATA_JSX, /document\.addEventListener\('visibilitychange', refreshVisibleData\)/);
  assert.match(DATA_JSX, /function startDashboardPolling\(intervalMs = STATIC_POLL_MS\)/);
  assert.match(DATA_JSX, /startDashboardPolling\(window\._DASHBOARD_PREFERRED_POLL_MS \|\| STATIC_POLL_MS\)/);
});
