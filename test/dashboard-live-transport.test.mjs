import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_JSX = readFileSync(join(HERE, "..", "dashboard", "public", "data.jsx"), "utf8");

test("dashboard live transport prefers baseline-aware freshest payloads and falls back to static snapshot", () => {
  assert.match(DATA_JSX, /const LIVE_STATUS_PATH = '\.\/api\/live-status'/);
  assert.match(DATA_JSX, /const LIVE_EVENTS_PATH = '\.\/api\/live-events'/);
  assert.match(DATA_JSX, /const STATIC_STATUS_PATH = '\.\/dashboard-status\.json'/);
  assert.match(DATA_JSX, /const LIVE_RUNTIME_PATH = '\.\/live-runtime\.json'/);
  assert.match(DATA_JSX, /async function fetchStaticStatusPayload\(\)/);
  assert.match(DATA_JSX, /function hasActiveReportingBaseline\(status = null\)/);
  assert.match(DATA_JSX, /function selectPreferredStatusPayload\(candidates = \[\]\)/);
  assert.match(DATA_JSX, /baselineDiff = Number\(hasActiveReportingBaseline\(right\.status\)\) - Number\(hasActiveReportingBaseline\(left\.status\)\)/);
  assert.match(DATA_JSX, /generatedAtDiff = \(statusGeneratedAtMs\(right\.status\) \|\| 0\) - \(statusGeneratedAtMs\(left\.status\) \|\| 0\)/);
  assert.match(DATA_JSX, /source: 'remote-live-api'/);
  assert.match(DATA_JSX, /source: 'live-api'/);
  assert.match(DATA_JSX, /const eventsPath = runtime\?\.enabled && runtime\.eventsUrl/);
  assert.match(DATA_JSX, /new EventSource\(eventsPath\)/);
  assert.match(DATA_JSX, /source: runtime\?\.enabled \? 'remote-live-sse' : 'live-sse'/);
  assert.match(DATA_JSX, /source: 'static-snapshot'/);
  assert.match(DATA_JSX, /preserveCurrentOnMismatch: Boolean\(payload\)/);
});
