import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildDashboardLiveRuntimeConfig,
} from "../src/cli/deploy-dashboard-cloudflare.mjs";
import {
  createDashboardLiveServer,
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
  assert.equal(typeof parsed.strategyTickRefreshMs, "number");
  assert.equal(typeof parsed.autoKillRefreshMs, "number");
  assert.equal(typeof parsed.statusBuildTimeoutMs, "number");
  assert.equal(parsed.refreshEnabled, true);
  assert.equal(parsed.corsOrigin, "*");
});

test("dashboard live runtime tracks every public dashboard refresh task", () => {
  const server = createDashboardLiveServer({
    port: 9998,
    refreshEnabled: false,
    rootDir: "dashboard/public",
  });
  const tasks = server.runtimeState().tasks;
  assert.ok(tasks.wholeWallet);
  assert.ok(tasks.treasury);
  assert.ok(tasks.walletHoldingsSlice);
  assert.ok(tasks.strategyTickStatus);
  assert.ok(tasks.autoKillEvents);
  assert.ok(tasks.statusSnapshot);
});

test("dashboard live status serves the latest public-safe disk snapshot without waiting for an in-process build", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-dashboard-live-"));
  await writeFile(
    join(rootDir, "dashboard-status.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      generatedAt: "2026-04-29T00:00:00.000Z",
      overall: { liveTrading: "BLOCKED" },
    })}\n`,
    "utf8",
  );
  let buildCalled = false;
  const server = createDashboardLiveServer({
    port: 9997,
    rootDir,
    refreshEnabled: false,
    statusBuildTimeoutMs: 5,
    buildCurrentContext: () => {
      buildCalled = true;
      return new Promise(() => {});
    },
  });

  const startedAt = Date.now();
  const status = await server.buildLiveStatus({ force: true });

  assert.equal(status.liveTransport.mode, "live_api");
  assert.equal(status.generatedAt, "2026-04-29T00:00:00.000Z");
  assert.equal(buildCalled, false);
  assert.ok(Date.now() - startedAt < 500);
});

test("buildDashboardLiveRuntimeConfig enables live origin endpoints when provided", () => {
  const payload = buildDashboardLiveRuntimeConfig({ liveOrigin: "https://example.trycloudflare.com/" });
  assert.equal(payload.enabled, true);
  assert.equal(payload.origin, "https://example.trycloudflare.com");
  assert.equal(payload.statusUrl, "https://example.trycloudflare.com/api/live-status");
  assert.equal(payload.eventsUrl, "https://example.trycloudflare.com/api/live-events");
});
