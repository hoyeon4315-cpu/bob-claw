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
  assert.equal(typeof parsed.refreshTaskTimeoutMs, "number");
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
    statusBuildTimeoutMs: 100,
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

test("dashboard live status overlays the freshest wallet holdings slice", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-dashboard-live-wallet-"));
  await writeFile(
    join(rootDir, "dashboard-status.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      generatedAt: "2026-04-29T00:00:00.000Z",
      walletHoldings: {
        generatedAt: "2026-04-29T00:00:00.000Z",
        observedAt: "2026-04-29T00:00:00.000Z",
        totalUsd: 10,
        items: [],
      },
      capitalSummary: {
        generatedAt: "2026-04-29T00:00:00.000Z",
        walletUsd: 10,
        deployedUsd: 0,
        totalUsd: 10,
      },
      strategy: {
        merklActivePositions: {
          items: [
            { label: "YO", chain: "base", protocol: "yo", capUsd: 5.25, pair: ["usdc"] },
          ],
        },
      },
    })}\n`,
    "utf8",
  );
  await writeFile(
    join(rootDir, "wallet-holdings.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-04-29T00:01:00.000Z",
      observedAt: "2026-04-29T00:00:59.000Z",
      pending: false,
      source: "live_scan_with_external_portfolio",
      totalUsd: 123.45,
      items: [{ sym: "ETH", chain: "base", usd: 12.3 }],
    })}\n`,
    "utf8",
  );

  const server = createDashboardLiveServer({
    port: 9996,
    rootDir,
    refreshEnabled: false,
  });
  const status = await server.buildLiveStatus({ force: true });

  assert.equal(status.walletHoldings.totalUsd, 123.45);
  assert.equal(status.capitalSummary.walletUsd, 123.45);
  assert.equal(status.capitalSummary.deployedUsd, 5.25);
  assert.equal(status.capitalSummary.totalUsd, 128.7);
  assert.equal(status.capitalSummary.walletObservedAt, "2026-04-29T00:00:59.000Z");
  assert.equal(status.liveOverlay.walletHoldings.source, "wallet-holdings.json");
});

test("dashboard live status refreshes active yield estimate at serve time", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-dashboard-live-yield-"));
  await writeFile(
    join(rootDir, "dashboard-status.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      generatedAt: "2026-04-29T00:00:00.000Z",
      market: { btcUsd: 100000 },
      walletHoldings: {
        generatedAt: "2026-04-29T00:00:00.000Z",
        observedAt: "2026-04-29T00:00:00.000Z",
        totalUsd: 10,
        items: [],
      },
      capitalSummary: {
        generatedAt: "2026-04-29T00:00:00.000Z",
        walletUsd: 10,
        deployedUsd: 365,
        totalUsd: 375,
      },
      strategy: {
        merklActivePositions: {
          items: [
            {
              id: "merkl_yield",
              label: "YO",
              chain: "base",
              protocol: "yo",
              capUsd: 365,
              aprPct: 10,
              lastObservedAt: "2026-04-28T00:00:00.000Z",
            },
          ],
        },
      },
      flow: {
        metrics: {},
        recentActivities: [],
        strategyRiskById: {},
      },
    })}\n`,
    "utf8",
  );

  const server = createDashboardLiveServer({
    port: 9995,
    rootDir,
    refreshEnabled: false,
  });
  const status = await server.buildLiveStatus({ force: true });

  assert.equal(status.flow.liveYield.status, "active");
  assert.equal(status.flow.liveYield.positionCount, 1);
  assert.equal(status.flow.liveYield.weightedAprPct, 10);
  assert.equal(status.flow.liveYield.generatedAt, status.liveTransport.servedAt);
  assert.equal(status.flow.metrics.liveYieldPositionCount, 1);
  assert.equal(status.flow.metrics.liveYieldAprPct, 10);
  assert.ok(status.flow.metrics.liveEstimatedYieldSats > 0);
});

test("dashboard live refresh task times out and clears running state when a script stalls", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-dashboard-live-timeout-"));
  await writeFile(
    join(rootDir, "dashboard-status.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      generatedAt: "2026-04-29T00:00:00.000Z",
      overall: { liveTrading: "ALLOWED" },
    })}\n`,
    "utf8",
  );

  const server = createDashboardLiveServer({
    port: 0,
    rootDir,
    refreshEnabled: true,
    refreshTickMs: 1000,
    wholeWalletRefreshMs: 60_000,
    treasuryRefreshMs: 60_000,
    strategyTickRefreshMs: 60_000,
    autoKillRefreshMs: 60_000,
    statusSnapshotRefreshMs: 1,
    refreshTaskTimeoutMs: 20,
    runNodeScript: (script) => {
      if (script === "src/cli/status-dashboard.mjs") return new Promise(() => {});
      return Promise.resolve({ status: 0, stdout: "", stderr: "" });
    },
  });

  await server.start();
  await new Promise((resolve) => setTimeout(resolve, 80));
  const task = server.runtimeState().tasks.statusSnapshot;
  await server.close();

  assert.equal(task.running, false);
  assert.ok(task.lastFailedAt);
  assert.match(task.lastError?.message || "", /timed out/u);
});

test("dashboard live defers expensive status snapshot refresh on startup", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-dashboard-live-defer-snapshot-"));
  await writeFile(
    join(rootDir, "dashboard-status.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      generatedAt: "2026-04-29T00:00:00.000Z",
      overall: { liveTrading: "ALLOWED" },
    })}\n`,
    "utf8",
  );

  const calls = [];
  const server = createDashboardLiveServer({
    port: 0,
    rootDir,
    refreshEnabled: true,
    refreshTickMs: 10,
    wholeWalletRefreshMs: 60_000,
    treasuryRefreshMs: 60_000,
    strategyTickRefreshMs: 60_000,
    autoKillRefreshMs: 60_000,
    statusSnapshotRefreshMs: 60_000,
    runNodeScript: (script) => {
      calls.push(script);
      return Promise.resolve({ status: 0, stdout: "", stderr: "" });
    },
  });

  await server.start();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await server.close();

  assert.equal(calls.includes("src/cli/status-dashboard.mjs"), false);
  assert.equal(server.runtimeState().tasks.statusSnapshot.lastStartedAt, null);
});

test("buildDashboardLiveRuntimeConfig enables live origin endpoints when provided", () => {
  const payload = buildDashboardLiveRuntimeConfig({ liveOrigin: "https://example.trycloudflare.com/" });
  assert.equal(payload.enabled, true);
  assert.equal(payload.origin, "https://example.trycloudflare.com");
  assert.equal(payload.statusUrl, "https://example.trycloudflare.com/api/live-status");
  assert.equal(payload.eventsUrl, "https://example.trycloudflare.com/api/live-events");
});
