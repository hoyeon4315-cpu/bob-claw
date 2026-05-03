import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
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

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function closeHttpServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function unusedPort() {
  const server = createHttpServer();
  const port = await listen(server, 0);
  await closeHttpServer(server);
  return port;
}

async function waitFor(predicate, timeoutMs = 500) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("condition was not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

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

test("dashboard live wallet overlay does not revive stale external wallet metadata", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-dashboard-live-wallet-meta-"));
  await writeFile(
    join(rootDir, "dashboard-status.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      generatedAt: "2026-05-02T00:00:00.000Z",
      walletHoldings: {
        generatedAt: "2026-05-02T00:00:00.000Z",
        observedAt: "2026-05-02T00:00:00.000Z",
        source: "whole_wallet_inventory",
        scanErrorCount: 2,
        scanErrors: [{ kind: "external_portfolio", provider: "zerion", message: "Zerion wallet portfolio request failed: 429" }],
        walletCoverage: "full_external_stale",
        fullWalletUsd: 243.22,
        fullWalletObservedAt: "2026-05-01T20:00:00.000Z",
        fullWalletProvider: "zerion",
        fullWalletStale: true,
        externalWalletUsd: 243.22,
        externalTotalPortfolioUsd: 240,
        itemizedSupportedWalletUsd: 216,
        unclassifiedUsd: 27.22,
        totalUsd: 216,
        items: [],
      },
      capitalSummary: {
        generatedAt: "2026-05-02T00:00:00.000Z",
        walletUsd: 216,
        deployedUsd: 5,
        totalUsd: 221,
        walletSource: "whole_wallet_inventory",
        walletScanErrorCount: 2,
        walletCoverage: "full_external_stale",
        fullWalletUsd: 243.22,
        fullWalletObservedAt: "2026-05-01T20:00:00.000Z",
        fullWalletProvider: "zerion",
        fullWalletStale: true,
        externalWalletUsd: 243.22,
        externalTotalPortfolioUsd: 240,
        itemizedSupportedWalletUsd: 216,
        unclassifiedUsd: 27.22,
        executorEstimatedTotalUsd: 457,
      },
      strategy: {
        merklActivePositions: {
          items: [
            { label: "YO", chain: "base", protocol: "yo", capUsd: 5.56, pair: ["usdc"] },
          ],
        },
      },
      flow: {
        metrics: { assetValueUsd: 221 },
        liveYield: null,
        recentActivities: [],
        strategyRiskById: {},
      },
    })}\n`,
    "utf8",
  );
  await writeFile(
    join(rootDir, "wallet-holdings.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-05-02T00:01:00.000Z",
      observedAt: "2026-05-02T00:00:59.000Z",
      pending: false,
      totalUsd: 216.44,
      items: [{ sym: "wbtc", chain: "base", usd: 41.4 }],
    })}\n`,
    "utf8",
  );

  const server = createDashboardLiveServer({
    port: 9993,
    rootDir,
    refreshEnabled: false,
  });
  const status = await server.buildLiveStatus({ force: true });

  assert.equal(status.walletHoldings.source, "whole_wallet_inventory");
  assert.equal(status.walletHoldings.scanErrorCount, 0);
  assert.deepEqual(status.walletHoldings.scanErrors, []);
  assert.equal(status.walletHoldings.walletCoverage, "partial_supported");
  assert.equal(status.walletHoldings.fullWalletUsd, null);
  assert.equal(status.capitalSummary.walletSource, "whole_wallet_inventory");
  assert.equal(status.capitalSummary.walletScanErrorCount, 0);
  assert.deepEqual(status.capitalSummary.walletScanErrors, []);
  assert.equal(status.capitalSummary.walletCoverage, "partial_supported");
  assert.equal(status.capitalSummary.fullWalletUsd, null);
  assert.equal(status.capitalSummary.displayWalletUsd, 216.44);
  assert.equal(status.capitalSummary.displayTotalUsd, 222);
  assert.equal(status.capitalSummary.displayTotalUsdSource, "partial_supported_wallet_plus_positions");
  assert.equal(status.capitalSummary.currentWalletUsd, 216.44);
  assert.equal(status.capitalSummary.protocolDeployedUsd, 5.56);
  assert.equal(status.capitalSummary.currentTotalUsd, 222);
  assert.equal(status.capitalSummary.assetFormula, "current_wallet_plus_tracked_protocol_positions");
  assert.equal(status.capitalSummary.fullWalletStale, false);
  assert.equal(status.capitalSummary.externalWalletUsd, null);
  assert.equal(status.capitalSummary.unclassifiedUsd, null);
  assert.equal(status.capitalSummary.totalUsd, 222);
  assert.equal(status.capitalSummary.executorEstimatedTotalUsd, null);
  assert.equal(status.flow.metrics.assetValueUsd, 222);
});

test("dashboard live status overlays strategy tick slice without waiting for full status rebuild", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-dashboard-live-tick-"));
  await writeFile(
    join(rootDir, "dashboard-status.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      generatedAt: "2026-04-29T00:00:00.000Z",
      strategy: {
        strategyParity: {
          generatedAt: "2026-04-29T00:00:00.000Z",
          rows: [
            {
              strategyId: "wrapped-btc-loop-base-moonwell",
              lastTickAt: "2026-04-29T00:00:00.000Z",
              promotionVerdict: "blocked",
              blockers: ["stale_blocker"],
            },
          ],
          byStrategy: {
            "wrapped-btc-loop-base-moonwell": {
              strategyId: "wrapped-btc-loop-base-moonwell",
              lastTickAt: "2026-04-29T00:00:00.000Z",
              promotionVerdict: "blocked",
              blockers: ["stale_blocker"],
            },
          },
        },
        microCanarySummary: { total: 0, byStrategy: {} },
      },
      flow: { metrics: {}, recentActivities: [], strategyRiskById: {} },
    })}\n`,
    "utf8",
  );
  await writeFile(
    join(rootDir, "strategy-tick-status.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      generatedAt: "2026-05-01T11:30:00.000Z",
      strategies: [
        {
          strategyId: "wrapped-btc-loop-base-moonwell",
          lastTickAt: "2026-05-01T11:29:55.000Z",
          lastTickMode: "live_candidate",
          lastTickBlockers: [],
          scoredAllocation: { strategyId: "wrapped-btc-loop-base-moonwell", allocatedSats: 12345 },
          demotion: { demoted: false, triggers: [] },
        },
      ],
      microCanary: {
        total: 1,
        byStrategy: {
          "wrapped-btc-loop-base-moonwell": { microCanaryStatus: "active" },
        },
      },
    })}\n`,
    "utf8",
  );

  const server = createDashboardLiveServer({
    port: 9994,
    rootDir,
    refreshEnabled: false,
  });
  const status = await server.buildLiveStatus({ force: true });
  const row = status.strategy.strategyParity.byStrategy["wrapped-btc-loop-base-moonwell"];

  assert.equal(row.lastTickAt, "2026-05-01T11:29:55.000Z");
  assert.equal(row.promotionVerdict, "live_candidate");
  assert.deepEqual(row.blockers, []);
  assert.equal(row.scoredAllocation.allocatedSats, 12345);
  assert.equal(row.microCanaryStatus, "active");
  assert.equal(status.strategy.strategyParity.generatedAt, "2026-05-01T11:30:00.000Z");
  assert.equal(status.strategy.microCanarySummary.total, 1);
  assert.equal(status.liveOverlay.strategyTickStatus.source, "strategy-tick-status.json");
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
    refreshTickMs: 50,
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
  await new Promise((resolve) => setTimeout(resolve, 90));
  const task = server.runtimeState().tasks.statusSnapshot;
  await server.close();

  assert.equal(task.running, false);
  assert.ok(task.lastFailedAt);
  assert.match(task.lastError?.message || "", /timed out/u);
});

test("dashboard live health and readiness agree while status snapshot refresh is degraded", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-dashboard-live-readiness-"));
  await writeFile(
    join(rootDir, "dashboard-status.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      generatedAt: "2026-05-02T00:00:00.000Z",
      overall: { liveTrading: "ALLOWED" },
    })}\n`,
    "utf8",
  );

  const server = createDashboardLiveServer({
    port: await unusedPort(),
    rootDir,
    refreshEnabled: true,
    refreshTickMs: 10,
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

  const local = await server.start();
  await new Promise((resolve) => setTimeout(resolve, 70));
  const healthResponse = await fetch(`${local.localUrl}/healthz`);
  const readyResponse = await fetch(`${local.localUrl}/readyz`);
  const health = await healthResponse.json();
  const ready = await readyResponse.json();
  await server.close();

  assert.equal(healthResponse.status, 200);
  assert.equal(readyResponse.status, 200);
  assert.equal(health.ready, true);
  assert.equal(ready.ready, true);
  assert.deepEqual(health.readiness, ready.readiness);
  assert.equal(health.readiness.degradedTasks.includes("statusSnapshot"), true);
  assert.match(health.tasks.statusSnapshot.lastError?.message || "", /timed out/u);
});

test("dashboard live health probe uses cached readiness without kicking due status refresh", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-dashboard-live-health-cache-"));
  await writeFile(
    join(rootDir, "dashboard-status.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      generatedAt: "2026-05-02T00:00:00.000Z",
      overall: { liveTrading: "ALLOWED" },
    })}\n`,
    "utf8",
  );

  const callsDuringHealthProbe = [];
  let trackingHealthProbe = false;
  const server = createDashboardLiveServer({
    port: await unusedPort(),
    rootDir,
    dataDir: rootDir,
    refreshEnabled: true,
    refreshTickMs: 60_000,
    wholeWalletRefreshMs: 60_000,
    treasuryRefreshMs: 60_000,
    strategyTickRefreshMs: 60_000,
    autoKillRefreshMs: 60_000,
    statusSnapshotRefreshMs: 25,
    runNodeScript: (script) => {
      if (trackingHealthProbe) callsDuringHealthProbe.push(script);
      return Promise.resolve({ status: 0, stdout: "", stderr: "" });
    },
  });

  const local = await server.start();
  await waitFor(() => Object.values(server.runtimeState().tasks).every((task) => !task.running));
  await new Promise((resolve) => setTimeout(resolve, 35));

  trackingHealthProbe = true;
  const healthResponse = await fetch(`${local.localUrl}/healthz`);
  const health = await healthResponse.json();
  trackingHealthProbe = false;
  const runtime = server.runtimeState();
  await server.close();

  assert.equal(healthResponse.status, 200);
  assert.equal(health.ready, true);
  assert.deepEqual(callsDuringHealthProbe, []);
  assert.equal(runtime.tasks.statusSnapshot.lastStartedAt, null);
});

test("dashboard live start rejects clearly when its port is already in use", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-dashboard-live-port-"));
  await writeFile(
    join(rootDir, "dashboard-status.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      generatedAt: "2026-05-02T00:00:00.000Z",
      overall: { liveTrading: "ALLOWED" },
    })}\n`,
    "utf8",
  );
  const blocker = createHttpServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("busy");
  });
  const port = await listen(blocker, 0);
  const server = createDashboardLiveServer({
    port,
    rootDir,
    refreshEnabled: false,
  });

  try {
    await assert.rejects(
      () => server.start(),
      /Dashboard live server port \d+ is already in use/u,
    );
  } finally {
    await server.close();
    await closeHttpServer(blocker);
  }
});

test("dashboard live start closes the listener when initial status build fails", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-dashboard-live-start-fail-"));
  await writeFile(join(rootDir, "dashboard-status.json"), "{ malformed json", "utf8");
  const port = await unusedPort();
  const server = createDashboardLiveServer({
    port,
    rootDir,
    dataDir: rootDir,
    refreshEnabled: false,
  });
  const rebound = createHttpServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("available");
  });

  try {
    await assert.rejects(
      () => server.start(),
      /JSON|Unexpected|Expected|dashboard-status/u,
    );
    await listen(rebound, port);
  } finally {
    if (rebound.listening) await closeHttpServer(rebound);
    await server.close();
  }
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
