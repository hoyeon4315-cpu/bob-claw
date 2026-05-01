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
  assert.match(DATA_JSX, /const preferRemoteStream = window\.LIVE_STATUS\?\.remote === true/);
  assert.match(DATA_JSX, /preferRemoteStream && runtime\?\.enabled && runtime\.eventsUrl/);
  assert.match(DATA_JSX, /new EventSource\(eventsPath\)/);
  assert.match(DATA_JSX, /source: preferRemoteStream \? 'remote-live-sse' : 'live-sse'/);
  assert.match(DATA_JSX, /source: 'static-snapshot'/);
  assert.match(DATA_JSX, /preserveCurrentOnMismatch: Boolean\(payload\)/);
});

test("dashboard live transport refreshes cached runtime and retries a changed public origin", () => {
  assert.match(DATA_JSX, /const LIVE_RUNTIME_REFRESH_MS = 30000/);
  assert.match(DATA_JSX, /async function resolveConfiguredLiveRuntime\(\{ forceRefresh = false \} = \{\}\)/);
  assert.match(DATA_JSX, /window\._DASHBOARD_LIVE_RUNTIME_RESOLVED_AT/);
  assert.match(DATA_JSX, /Date\.now\(\) - window\._DASHBOARD_LIVE_RUNTIME_RESOLVED_AT < LIVE_RUNTIME_REFRESH_MS/);
  assert.match(DATA_JSX, /const refreshedRuntime = await resolveConfiguredLiveRuntime\(\{ forceRefresh: true \}\)/);
  assert.match(DATA_JSX, /refreshedRuntime\.statusUrl !== runtime\.statusUrl/);
  assert.match(DATA_JSX, /window\._DASHBOARD_LIVE_STREAM_URL === eventsBasePath/);
});
