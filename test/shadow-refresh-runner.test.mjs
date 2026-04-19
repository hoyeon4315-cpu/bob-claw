import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildShadowRefreshExecutionSummary,
  executeRefreshQueueItem,
  inferRefreshItemOutcome,
  parseWhitelistedRefreshCommand,
  splitCommandSequence,
  tokenizeCommandSegment,
} from "../src/session/shadow-refresh-runner.mjs";

test("refresh runner splits and tokenizes compound npm commands", () => {
  const command =
    'npm run verify:gateway -- --route-key="base:0x0555->unichain:0x0555" --amounts=25000 && npm run quote:dex -- --route-key="base:0x0555->unichain:0x0555" --amount=25000 --include-stable-entry && npm run score:gateway -- --write --route-key="base:0x0555->unichain:0x0555" --amount=25000';
  const segments = splitCommandSequence(command);
  assert.equal(segments.length, 3);
  assert.deepEqual(tokenizeCommandSegment(segments[0]).slice(0, 3), ["npm", "run", "verify:gateway"]);
  const parsed = parseWhitelistedRefreshCommand(command);
  assert.deepEqual(parsed.map((step) => step.script), ["verify:gateway", "quote:dex", "score:gateway"]);
});

test("refresh runner rejects non-whitelisted or shell-injected commands", () => {
  assert.throws(() => parseWhitelistedRefreshCommand("npm run unknown:script -- --foo=1"), /not whitelisted/);
  assert.throws(() => parseWhitelistedRefreshCommand("npm run status:dashboard; rm -rf /"), /not whitelisted|Forbidden shell syntax/);
});

test("refresh queue item previews without executing", async () => {
  const record = await executeRefreshQueueItem({
    rank: 1,
    scope: "execution_review",
    code: "check_wallet_readiness",
    routeLabel: "ethereum->base",
    amount: "10000",
    command: 'npm run check:estimator-wallet -- --route-key="ethereum:0x2260->base:0x0555" --amount="10000"',
  });

  assert.equal(record.executionStatus, "preview");
  assert.equal(record.stepCount, 1);
  assert.equal(record.steps[0].script, "check:estimator-wallet");
});

test("refresh runner previews ETH-family observe-only queue commands", async () => {
  const record = await executeRefreshQueueItem({
    rank: 1,
    scope: "eth_family_watch",
    code: "collect_eth_family_evidence",
    routeLabel: "ETH-family watch base->bob",
    command:
      'npm run scan:quote-surface -- --route-key="base:0xeth->bob:0xeth" && npm run analyze:ethereum-routes -- --write && npm run audit:eth-family-overfit && npm run status:dashboard',
  });

  assert.equal(record.executionStatus, "preview");
  assert.equal(record.stepCount, 4);
  assert.deepEqual(record.steps.map((step) => step.script), [
    "scan:quote-surface",
    "analyze:ethereum-routes",
    "audit:eth-family-overfit",
    "status:dashboard",
  ]);
});

test("refresh queue item executes sequential steps and stops on failure", async () => {
  const calls = [];
  const record = await executeRefreshQueueItem(
    {
      rank: 2,
      scope: "strategy_discovery",
      code: "validate_route_durability",
      routeLabel: "base->unichain",
      amount: "25000",
      command:
        'npm run verify:gateway -- --route-key="base:0x0555->unichain:0x0555" --amounts=25000 && npm run quote:dex -- --route-key="base:0x0555->unichain:0x0555" --amount=25000 --include-stable-entry',
    },
    {
      execute: true,
      runCommand: async ({ step }) => {
        calls.push(step.script);
        if (step.script === "quote:dex") {
          return { ok: false, exitCode: 1, signal: null, durationMs: 12, stdout: "", stderr: "dex failed" };
        }
        return { ok: true, exitCode: 0, signal: null, durationMs: 8, stdout: "ok", stderr: "" };
      },
    },
  );

  assert.deepEqual(calls, ["verify:gateway", "quote:dex"]);
  assert.equal(record.executionStatus, "failed");
  assert.equal(record.steps.length, 2);
  assert.equal(record.steps[1].stderrSummary, "dex failed");
  assert.equal(record.outcomeCategory, null);
});

test("refresh queue item classifies transient RPC wallet readiness failures", async () => {
  const record = await executeRefreshQueueItem(
    {
      rank: 1,
      scope: "active_canary",
      code: "check_wallet_readiness",
      routeLabel: "soneium->bob",
      amount: "100",
      command: 'npm run check:estimator-wallet -- --route-key="soneium:0x0555->bob:0x0555" --amount="100"',
    },
    {
      execute: true,
      runCommand: async () => ({
        ok: false,
        exitCode: 1,
        signal: null,
        durationMs: 9,
        stdout: "",
        stderr: "AccountStateRpcError: All RPC endpoints failed for chain: soneium",
      }),
    },
  );

  assert.equal(record.executionStatus, "failed");
  assert.equal(record.outcomeCategory, "rpc_unavailable");
  assert.equal(record.readinessStatus, "unknown");
  assert.equal(record.transientFailure, true);
  assert.deepEqual(record.readinessGaps, []);
});

test("refresh queue item classifies wallet readiness gaps separately from command failure", async () => {
  const record = await executeRefreshQueueItem(
    {
      rank: 1,
      scope: "active_canary",
      code: "check_wallet_readiness",
      routeLabel: "soneium->bob",
      amount: "100",
      command: 'npm run check:estimator-wallet -- --route-key="soneium:0x0555->bob:0x0555" --amount="100"',
    },
    {
      execute: true,
      runCommand: async () => ({
        ok: true,
        exitCode: 0,
        signal: null,
        durationMs: 11,
        stdout: "soneium->bob nativeReady=false tokenReady=true native=0.000000",
        stderr: "",
      }),
    },
  );

  assert.equal(record.executionStatus, "succeeded");
  assert.equal(record.outcomeCategory, "wallet_not_ready");
  assert.equal(record.readinessStatus, "blocked");
  assert.equal(record.transientFailure, false);
  assert.deepEqual(record.readinessGaps, ["native"]);
});

test("refresh execution summary aggregates recent outcomes", () => {
  const summary = buildShadowRefreshExecutionSummary([
    {
      observedAt: "2026-04-12T12:00:00.000Z",
      rank: 1,
      scope: "canary",
      code: "check_wallet_readiness",
      routeLabel: "base->avalanche",
      amount: "100000",
      executionStatus: "succeeded",
      outcomeCategory: "wallet_ready",
      readinessStatus: "ready",
      readinessGaps: [],
      transientFailure: false,
      stepCount: 1,
      steps: [{ script: "check:estimator-wallet", exitCode: 0 }],
    },
    {
      observedAt: "2026-04-12T12:01:00.000Z",
      rank: 2,
      scope: "strategy_discovery",
      code: "validate_route_durability",
      routeLabel: "base->unichain",
      amount: "25000",
      executionStatus: "failed",
      stepCount: 2,
      steps: [{ script: "verify:gateway", exitCode: 0 }, { script: "quote:dex", exitCode: 1 }],
    },
  ]);

  assert.equal(summary.runCount, 2);
  assert.equal(summary.successCount, 1);
  assert.equal(summary.failureCount, 1);
  assert.equal(summary.latestStatus, "failed");
  assert.equal(summary.recentExecutions[0].scripts[0], "verify:gateway");
  assert.equal(summary.recentExecutions[1].outcomeCategory, "wallet_ready");
});

test("refresh runner infers wallet readiness outcome from persisted step logs", () => {
  const inferred = inferRefreshItemOutcome({
    code: "check_wallet_readiness",
    executionStatus: "failed",
    steps: [
      {
        script: "check:estimator-wallet",
        stderrSummary: "AccountStateRpcError: All RPC endpoints failed for chain: soneium",
      },
    ],
  });

  assert.equal(inferred.outcomeCategory, "rpc_unavailable");
  assert.equal(inferred.transientFailure, true);
});
