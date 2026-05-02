import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAutomationHealthReport,
  collectAutomationHealthReport,
} from "../src/system/automation-health-report.mjs";

function source(path, json) {
  return { path, present: true, json };
}

test("buildAutomationHealthReport summarizes runtime, launchd, dashboard, queues, remediation, and blockers", () => {
  const report = buildAutomationHealthReport({
    now: "2026-05-02T10:00:00.000Z",
    sources: {
      runtimeReadiness: source("data/executor-runtime-readiness.json", {
        summary: {
          ready: false,
          envReady: true,
          launchdConfigured: true,
          launchdLoaded: false,
          runtimeHealthy: false,
          nextActionCode: "install_launchd_agents",
        },
      }),
      dashboardStatus: source("dashboard/public/dashboard-status.json", {
        generatedAt: "2026-05-02T09:55:00.000Z",
        overall: {
          severity: "review",
          liveTrading: "BLOCKED",
          blockers: ["executor_runtime_unavailable"],
        },
        gateway: {
          routeCount: 113,
          chainCount: 10,
          announcedChainCoverage: { missingAnnouncedChains: ["optimism", "sei"] },
        },
      }),
      liveRuntime: source("dashboard/public/live-runtime.json", {
        enabled: true,
        origin: "https://example.invalid",
        updatedAt: "2026-05-02T09:56:00.000Z",
      }),
      strategyTickStatus: source("dashboard/public/strategy-tick-status.json", {
        generatedAt: "2026-05-02T09:57:00.000Z",
        latestTickAt: "2026-05-02T09:50:00.000Z",
        strategies: [
          {
            strategyId: "s1",
            liveEligibility: { liveEligible: false, blockers: ["cap_missing"] },
            promotion: { strict: { blockers: ["insufficient_receipts"] } },
          },
          {
            strategyId: "s2",
            liveEligibility: { liveEligible: true, blockers: [] },
            promotion: { strict: { blockers: [] } },
          },
        ],
      }),
      allChainAutopilotLatest: source("data/all-chain-autopilot-latest.json", {
        observedAt: "2026-05-02T09:58:00.000Z",
        status: "completed_with_blockers",
        blockedReason: "refill_routes_unresolved",
        summary: {
          officialChainCount: 11,
          refillJobCount: 3,
          refillAttemptedCount: 2,
          refillExecutedCount: 1,
          strategyDispatch: {
            batchStatus: "completed",
            selectedCount: 4,
            liveEligibleCount: 2,
            missingExecutorCount: 0,
          },
          payback: {
            status: "carry",
            reason: "below_min_payback",
            pendingCarrySats: 2500,
          },
        },
        refillExecutions: [
          {
            chain: "ethereum",
            asset: "USDC",
            executed: false,
            executionBlockedReason: "route_unavailable",
          },
        ],
      }),
      merklCanaryQueue: source("data/merkl-canary-queue.json", {
        summary: {
          queueCount: 3,
          representativeCoverage: {
            activeRepresentativeChainCount: 1,
            queuedRepresentativeChainCount: 1,
            missingRepresentativeChainCount: 2,
            missingChains: ["sei", "optimism"],
          },
        },
        queue: [
          { opportunityId: "a", chain: "base", protocolId: "yo", blockers: [] },
          { opportunityId: "b", chain: "ethereum", protocolId: "morpho", blockers: ["inventory_missing"] },
          { opportunityId: "c", chain: "ethereum", protocolId: "aave", blockers: ["inventory_missing"] },
        ],
      }),
      deterministicCandidates: source("data/deterministic-strategy-candidates.json", {
        candidates: [
          { id: "d1", chain: "sonic", blockers: ["dry_run_receipt_missing"] },
        ],
      }),
      routeRemediation: source("data/route-remediation-autopilot.json", {
        status: "blocked",
        candidateCount: 12,
        workOrderCount: 0,
        blockedCandidateCount: 12,
        blockedCandidates: [
          { id: "r1", chain: "ethereum", blockers: ["cost_variance_unmeasured"] },
        ],
      }),
    },
    launchdComponents: [
      { id: "executor-daemon", kind: "executor", label: "com.bobclaw.executor-daemon", plistPresent: true },
      { id: "all-chain-autopilot", kind: "liveAutomation", label: "com.bobclaw.all-chain-autopilot", plistPresent: false },
    ],
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.forbiddenActions, ["kill_switch_toggle", "daemon_start", "daemon_restart", "signer_call", "trade_execution"]);
  assert.equal(report.status, "attention_required");
  assert.equal(report.runtimeReadiness.ready, false);
  assert.equal(report.runtimeReadiness.nextActionCode, "install_launchd_agents");
  assert.equal(report.launchd.summary.expectedCount, 2);
  assert.equal(report.launchd.summary.configuredCount, 1);
  assert.equal(report.dashboard.liveTrading, "BLOCKED");
  assert.equal(report.dashboard.gatewayRouteCount, 113);
  assert.equal(report.allChain.present, true);
  assert.equal(report.allChain.refillBlockedCount, 1);
  assert.equal(report.queues.totalCandidates, 4);
  assert.deepEqual(report.queues.byChain, { base: 1, ethereum: 2, sonic: 1 });
  assert.equal(report.queues.representativeCoverage.missingRepresentativeChainCount, 2);
  assert.equal(report.routeRemediation.present, true);
  assert.equal(report.routeRemediation.status, "blocked");
  assert.equal(report.topBlockers[0].reason, "inventory_missing");
  assert.equal(report.topBlockers[0].count, 2);
});

test("buildAutomationHealthReport reports missing optional snapshots without inventing readiness", () => {
  const report = buildAutomationHealthReport({
    now: "2026-05-02T10:00:00.000Z",
    sources: {},
    launchdComponents: [],
  });

  assert.equal(report.status, "attention_required");
  assert.equal(report.runtimeReadiness.present, false);
  assert.equal(report.runtimeReadiness.ready, null);
  assert.equal(report.routeRemediation.present, false);
  assert.ok(report.topBlockers.some((item) => item.reason === "runtime_readiness_snapshot_missing"));
  assert.ok(report.topBlockers.some((item) => item.reason === "dashboard_status_missing"));
});

test("buildAutomationHealthReport prefers a fresher running all-chain snapshot over stale completed status", () => {
  const report = buildAutomationHealthReport({
    now: "2026-05-02T10:10:00.000Z",
    sources: {
      allChainAutopilotLatest: source("data/all-chain-autopilot-latest.json", {
        observedAt: "2026-05-02T10:07:00.000Z",
        status: "running",
        phase: "refill_complete",
        summary: {
          officialChainCount: 11,
          refillJobCount: 3,
          refillAttemptedCount: 1,
          refillExecutedCount: 1,
          strategyDispatch: { capitalDispatchReadiness: "ready" },
        },
        refillExecutions: [
          { chain: "bsc", asset: "wBTC.OFT", executed: true, executionStatus: "delivered" },
          { chain: "ethereum", asset: "RLUSD", executed: false, previewBlockedReason: "routing_exhausted" },
        ],
      }),
      allChainAutopilotLatestCompleted: source("data/all-chain-autopilot-latest-completed.json", {
        observedAt: "2026-05-02T09:25:00.000Z",
        status: "completed_with_blockers",
        summary: {
          officialChainCount: 11,
          refillJobCount: 3,
          refillAttemptedCount: 2,
          refillExecutedCount: 0,
        },
        refillExecutions: [
          { chain: "bsc", asset: "wBTC.OFT", executed: false, executionBlockedReason: "signer_rejected" },
          { chain: "ethereum", asset: "RLUSD", executed: false, previewBlockedReason: "routing_exhausted" },
        ],
      }),
    },
    launchdComponents: [],
  });

  assert.equal(report.allChain.observedAt, "2026-05-02T10:07:00.000Z");
  assert.equal(report.allChain.status, "running");
  assert.equal(report.allChain.refillExecutedCount, 1);
  assert.equal(report.allChain.refillBlockedCount, 1);
  assert.equal(report.topBlockers.some((item) => item.reason === "signer_rejected"), false);
});

test("collectAutomationHealthReport reads only configured snapshot paths", async () => {
  const readPaths = [];
  const existsPaths = [];
  const report = await collectAutomationHealthReport({
    rootDir: "/repo",
    now: "2026-05-02T10:00:00.000Z",
    launchdSpecBuilder: () => [
      { id: "daemon", label: "com.bobclaw.executor-daemon", plistPath: "/repo/launchd/daemon.plist" },
    ],
    readJsonFile: async (path) => {
      readPaths.push(path);
      if (path.endsWith("dashboard-status.json")) {
        return {
          overall: { liveTrading: "ALLOWED", blockers: [] },
          gateway: { routeCount: 1, chainCount: 1 },
        };
      }
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
    pathExists: async (path) => {
      existsPaths.push(path);
      return path.endsWith("daemon.plist");
    },
  });

  assert.equal(report.dashboard.present, true);
  assert.equal(report.launchd.components[0].plistPresent, true);
  assert.ok(readPaths.some((path) => path.endsWith("dashboard-status.json")));
  assert.deepEqual(existsPaths, ["/repo/launchd/daemon.plist"]);
});

test("collectAutomationHealthReport prefers data dashboard live runtime and falls back to public runtime", async () => {
  const withDataRuntime = await collectAutomationHealthReport({
    rootDir: "/repo",
    now: "2026-05-03T00:00:00.000Z",
    launchdSpecBuilder: () => [],
    readJsonFile: async (path) => {
      if (path.endsWith("data/dashboard-live-runtime.json")) {
        return {
          enabled: true,
          origin: "https://live.example.invalid",
          updatedAt: "2026-05-03T00:00:00.000Z",
        };
      }
      if (path.endsWith("dashboard/public/live-runtime.json")) {
        return {
          enabled: false,
          origin: null,
          updatedAt: "2026-05-02T00:00:00.000Z",
        };
      }
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
    pathExists: async () => false,
  });

  assert.equal(withDataRuntime.dashboard.liveRuntime.enabled, true);
  assert.equal(withDataRuntime.dashboard.liveRuntime.origin, "https://live.example.invalid");
  assert.ok(withDataRuntime.dashboard.liveRuntime.sourcePath.endsWith("data/dashboard-live-runtime.json"));

  const fallbackRuntime = await collectAutomationHealthReport({
    rootDir: "/repo",
    now: "2026-05-03T00:00:00.000Z",
    launchdSpecBuilder: () => [],
    readJsonFile: async (path) => {
      if (path.endsWith("dashboard/public/live-runtime.json")) {
        return {
          enabled: false,
          origin: null,
          updatedAt: "2026-05-02T00:00:00.000Z",
        };
      }
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
    pathExists: async () => false,
  });

  assert.equal(fallbackRuntime.dashboard.liveRuntime.enabled, false);
  assert.ok(fallbackRuntime.dashboard.liveRuntime.sourcePath.endsWith("dashboard/public/live-runtime.json"));
});
