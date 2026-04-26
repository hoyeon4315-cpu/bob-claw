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
  assert.match(DATA_JSX, /const apyPct = Number\.isFinite\(m\.aprPct\)/);
  assert.match(DATA_JSX, /yieldBasis: realizedYieldUsd > 0 \? 'realized' : \(estimatedYieldUsd > 0 \? 'estimated' : null\)/);
  assert.doesNotMatch(DATA_JSX, /earnedUsd:\s*0,\s*\n\s*apyPct:/);
});
