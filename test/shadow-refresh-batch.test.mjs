import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildShadowRefreshBatchSummary,
  executeShadowRefreshBatch,
} from "../src/session/shadow-refresh-batch.mjs";

test("refresh batch previews queue items without follow-up execution", async () => {
  const record = await executeShadowRefreshBatch({
    queueItems: [
      {
        rank: 1,
        scope: "execution_review",
        code: "check_wallet_readiness",
        routeLabel: "base->avalanche",
        command: 'npm run check:estimator-wallet -- --route-key="base:0x0555->avalanche:0x0555" --amount=10000',
      },
    ],
    execute: false,
  });

  assert.equal(record.mode, "preview");
  assert.equal(record.batchStatus, "preview");
  assert.equal(record.queueResults.length, 1);
  assert.equal(record.queueResults[0].executionStatus, "preview");
  assert.equal(record.followUps.length, 0);
});

test("refresh batch stops on the first failed queue item", async () => {
  const calls = [];
  const record = await executeShadowRefreshBatch({
    queueItems: [
      {
        rank: 1,
        scope: "execution_review",
        code: "check_wallet_readiness",
        routeLabel: "base->avalanche",
        command: 'npm run check:estimator-wallet -- --route-key="base:0x0555->avalanche:0x0555" --amount=10000',
      },
      {
        rank: 2,
        scope: "strategy_discovery",
        code: "second",
        routeLabel: "avalanche->bsc",
        command: 'npm run check:estimator-wallet -- --route-key="avalanche:0x0555->bsc:0x0555" --amount=10000',
      },
    ],
    execute: true,
    readGuards: async () => ({
      emergencyStopActive: false,
      blocked: false,
      reasons: [],
    }),
    runCommand: async ({ step }) => {
      calls.push(step.script);
      return {
        ok: false,
        exitCode: 1,
        signal: null,
        durationMs: 5,
        stdout: "",
        stderr: "failed",
      };
    },
  });

  assert.equal(record.batchStatus, "failed");
  assert.equal(record.stopReason, "queue_item_failed");
  assert.equal(record.queueResults.length, 1);
  assert.equal(record.followUps.length, 0);
  assert.deepEqual(calls, ["check:estimator-wallet"]);
  assert.equal(record.queueResults[0].outcomeCategory, "wallet_check_failed");
});

test("refresh batch runs follow-up commands after successful queue execution", async () => {
  const calls = [];
  const record = await executeShadowRefreshBatch({
    queueItems: [
      {
        rank: 1,
        scope: "execution_review",
        code: "check_wallet_readiness",
        routeLabel: "base->avalanche",
        command: 'npm run check:estimator-wallet -- --route-key="base:0x0555->avalanche:0x0555" --amount=10000',
      },
    ],
    execute: true,
    followUpCommands: [
      "npm run status:dashboard",
      "npm run plan:shadow-refreshes -- --write",
    ],
    readGuards: async () => ({
      emergencyStopActive: false,
      blocked: false,
      reasons: [],
    }),
    runCommand: async ({ step }) => {
      calls.push(step.script);
      return {
        ok: true,
        exitCode: 0,
        signal: null,
        durationMs: 7,
        stdout: "ok",
        stderr: "",
      };
    },
  });

  assert.equal(record.batchStatus, "succeeded");
  assert.equal(record.stopReason, null);
  assert.deepEqual(calls, ["check:estimator-wallet", "status:dashboard", "plan:shadow-refreshes"]);
  assert.equal(record.followUps.length, 2);
  assert.equal(record.followUps[0].scripts[0], "status:dashboard");
  assert.equal(record.followUps[1].scripts[0], "plan:shadow-refreshes");
});

test("refresh batch summary aggregates execute and preview outcomes", () => {
  const summary = buildShadowRefreshBatchSummary([
    {
      observedAt: "2026-04-12T12:00:00.000Z",
      batchId: "b1",
      mode: "execute",
      batchStatus: "succeeded",
      stopReason: null,
      selectedCount: 1,
      queueResults: [{ executionStatus: "succeeded" }],
      followUps: [],
      circuitBreaker: { blocked: false },
    },
    {
      observedAt: "2026-04-12T12:01:00.000Z",
      batchId: "b2",
      mode: "execute",
      batchStatus: "failed",
      stopReason: "queue_item_failed",
      selectedCount: 2,
      queueResults: [{ executionStatus: "failed", outcomeCategory: "rpc_unavailable", routeLabel: "soneium->bob", transientFailure: true }],
      followUps: [],
      circuitBreaker: { blocked: false },
    },
    {
      observedAt: "2026-04-12T12:02:00.000Z",
      batchId: "b3",
      mode: "preview",
      batchStatus: "preview",
      stopReason: null,
      selectedCount: 1,
      queueResults: [],
      followUps: [],
      circuitBreaker: { blocked: false },
    },
  ]);

  assert.equal(summary.runCount, 2);
  assert.equal(summary.successCount, 1);
  assert.equal(summary.failureCount, 1);
  assert.equal(summary.latestStatus, "preview");
  assert.equal(summary.latestMode, "preview");
  assert.equal(summary.latestStopReason, null);
  assert.equal(summary.recentBatches[0].batchId, "b3");
  assert.equal(summary.recentBatches[1].queueFailureCategory, "rpc_unavailable");
  assert.equal(summary.recentBatches[1].queueFailureTransient, true);
  assert.equal(summary.recentBatches[1].queueFailureRouteLabel, "soneium->bob");
});

test("refresh batch summary surfaces latest queue failure category", () => {
  const summary = buildShadowRefreshBatchSummary([
    {
      observedAt: "2026-04-12T12:00:00.000Z",
      batchId: "b1",
      mode: "execute",
      batchStatus: "failed",
      stopReason: "queue_item_failed",
      selectedCount: 1,
      queueResults: [{ executionStatus: "failed", outcomeCategory: "rpc_unavailable", routeLabel: "soneium->bob", transientFailure: true }],
      followUps: [],
      circuitBreaker: { blocked: false },
    },
  ]);

  assert.equal(summary.latestFailureCategory, "rpc_unavailable");
  assert.equal(summary.latestFailureRouteLabel, "soneium->bob");
});

test("refresh batch summary backfills legacy queue failure categories and keeps recent failure visible", () => {
  const summary = buildShadowRefreshBatchSummary([
    {
      observedAt: "2026-04-12T12:02:00.000Z",
      batchId: "b3",
      mode: "execute",
      batchStatus: "succeeded",
      stopReason: null,
      selectedCount: 1,
      queueResults: [{ executionStatus: "succeeded" }],
      followUps: [],
      circuitBreaker: { blocked: false },
    },
    {
      observedAt: "2026-04-12T12:01:00.000Z",
      batchId: "b2",
      mode: "execute",
      batchStatus: "failed",
      stopReason: "queue_item_failed",
      selectedCount: 1,
      queueResults: [
        {
          code: "check_wallet_readiness",
          executionStatus: "failed",
          routeLabel: "soneium->bob",
          steps: [{ script: "check:estimator-wallet", stderrSummary: "AccountStateRpcError: All RPC endpoints failed for chain: soneium" }],
        },
      ],
      followUps: [],
      circuitBreaker: { blocked: false },
    },
  ]);

  assert.equal(summary.latestStatus, "succeeded");
  assert.equal(summary.latestFailureCategory, null);
  assert.equal(summary.recentFailureCategory, "rpc_unavailable");
  assert.equal(summary.recentFailureRouteLabel, "soneium->bob");
  assert.equal(summary.recentFailureTransient, true);
  assert.equal(summary.recentBatches[1].queueFailureCategory, "rpc_unavailable");
});
