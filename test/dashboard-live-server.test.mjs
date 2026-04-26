import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDashboardLiveRuntimeConfig,
} from "../src/cli/deploy-dashboard-cloudflare.mjs";
import {
  extractQuickTunnelUrl,
  parseDashboardLiveArgs,
} from "../src/dashboard/live-server.mjs";

test("extractQuickTunnelUrl returns trycloudflare public url from log output", () => {
  assert.equal(
    extractQuickTunnelUrl("Visit it at https://venues-officers-swaziland-carpet.trycloudflare.com now"),
    "https://venues-officers-swaziland-carpet.trycloudflare.com",
  );
  assert.equal(extractQuickTunnelUrl("no url here"), null);
});

test("parseDashboardLiveArgs includes refresh cadence defaults", () => {
  const parsed = parseDashboardLiveArgs(["--port=9999", "--stream-ms=5000", "--whole-wallet-refresh-ms=20000"], {});
  assert.equal(parsed.port, 9999);
  assert.equal(parsed.streamMs, 5000);
  assert.equal(parsed.wholeWalletRefreshMs, 20000);
  assert.equal(parsed.refreshEnabled, true);
  assert.equal(parsed.corsOrigin, "*");
});

test("buildDashboardLiveRuntimeConfig enables live origin endpoints when provided", () => {
  const payload = buildDashboardLiveRuntimeConfig({ liveOrigin: "https://example.trycloudflare.com/" });
  assert.equal(payload.enabled, true);
  assert.equal(payload.origin, "https://example.trycloudflare.com");
  assert.equal(payload.statusUrl, "https://example.trycloudflare.com/api/live-status");
  assert.equal(payload.eventsUrl, "https://example.trycloudflare.com/api/live-events");
});
