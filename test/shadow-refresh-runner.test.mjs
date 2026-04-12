import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildShadowRefreshExecutionSummary,
  executeRefreshQueueItem,
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
});
