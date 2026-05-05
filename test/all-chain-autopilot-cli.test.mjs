import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs, runAutopilotCommand } from "../src/cli/run-all-chain-autopilot.mjs";

test("all-chain CLI parses controlled refill stop mode", () => {
  const args = parseArgs(["--execute", "--dry-run-first", "--stop-after-refill"]);
  assert.equal(args.execute, true);
  assert.equal(args.dryRunFirst, true);
  assert.equal(args.stopAfterRefill, true);
});

test("all-chain dry-run-first does not execute after preview blockers", async () => {
  const calls = [];
  const outcome = await runAutopilotCommand(
    {
      execute: true,
      dryRunFirst: true,
    },
    {
      runner: async (args) => {
        calls.push(args);
        return {
          status: args.execute ? "completed" : "completed_with_blockers",
          blockedReason: null,
        };
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].execute, false);
  assert.equal(outcome.mode, "dry_run_first");
  assert.equal(outcome.execution, null);
  assert.equal(outcome.final.status, "completed_with_blockers");
  assert.equal(outcome.executionSkippedReason, "preview_not_full_green");
});

test("all-chain dry-run-first executes after live-safe preview-only deferrals", async () => {
  const calls = [];
  const outcome = await runAutopilotCommand(
    {
      execute: true,
      dryRunFirst: true,
    },
    {
      runner: async (args) => {
        calls.push(args);
        return args.execute
          ? {
              status: "completed_with_blockers",
              blockedReason: null,
            }
          : {
              status: "completed_with_blockers",
              blockedReason: null,
              summary: {
                autoKill: {
                  triggered: false,
                  killSwitchActive: false,
                  alreadyArmed: false,
                },
                executionGate: {
                  blockedReason: "preview_only",
                  autoKillTriggered: false,
                  killSwitchActive: false,
                  killSwitchAlreadyArmed: false,
                },
                payback: {
                  status: "carry",
                  reason: "planned_payback_below_minimum",
                },
              },
              refillExecutions: [
                {
                  previewStatus: "deferred",
                  previewBlockedReason: "routing_exhausted",
                  routeDeferralReason: "bridge_route_unavailable_gateway_no_route_lifi_quote_rejected",
                  routeDeferralAction: "defer_until_bridge_provider_supports_pair",
                },
                {
                  previewStatus: "ready",
                  previewBlockedReason: null,
                },
              ],
            };
      },
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].execute, false);
  assert.equal(calls[1].execute, true);
  assert.equal(outcome.preview.status, "completed_with_blockers");
  assert.equal(outcome.execution.status, "completed_with_blockers");
  assert.equal(outcome.final, outcome.execution);
});

test("all-chain dry-run-first still blocks unsafe refill preview blockers", async () => {
  const calls = [];
  const outcome = await runAutopilotCommand(
    {
      execute: true,
      dryRunFirst: true,
    },
    {
      runner: async (args) => {
        calls.push(args);
        return {
          status: "completed_with_blockers",
          blockedReason: null,
          summary: {
            autoKill: {
              triggered: false,
              killSwitchActive: false,
              alreadyArmed: false,
            },
            executionGate: {
              blockedReason: "preview_only",
              autoKillTriggered: false,
              killSwitchActive: false,
              killSwitchAlreadyArmed: false,
            },
          },
          refillExecutions: [
            {
              previewStatus: "blocked",
              previewBlockedReason: "source_inventory_reserved",
            },
          ],
        };
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].execute, false);
  assert.equal(outcome.execution, null);
  assert.equal(outcome.executionSkippedReason, "preview_not_full_green");
});

test("all-chain dry-run-first blocks unclassified refill deferrals", async () => {
  const calls = [];
  const outcome = await runAutopilotCommand(
    {
      execute: true,
      dryRunFirst: true,
    },
    {
      runner: async (args) => {
        calls.push(args);
        return {
          status: "completed_with_blockers",
          blockedReason: null,
          summary: {
            autoKill: {
              triggered: false,
              killSwitchActive: false,
              alreadyArmed: false,
            },
            executionGate: {
              blockedReason: "preview_only",
              autoKillTriggered: false,
              killSwitchActive: false,
              killSwitchAlreadyArmed: false,
            },
          },
          refillExecutions: [
            {
              previewStatus: "deferred",
              previewBlockedReason: null,
            },
          ],
        };
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(outcome.execution, null);
  assert.equal(outcome.executionSkippedReason, "preview_not_full_green");
});

test("all-chain dry-run-first blocks unclassified payback preview statuses", async () => {
  const calls = [];
  const outcome = await runAutopilotCommand(
    {
      execute: true,
      dryRunFirst: true,
    },
    {
      runner: async (args) => {
        calls.push(args);
        return {
          status: "completed_with_blockers",
          blockedReason: null,
          summary: {
            autoKill: {
              triggered: false,
              killSwitchActive: false,
              alreadyArmed: false,
            },
            executionGate: {
              blockedReason: "preview_only",
              autoKillTriggered: false,
              killSwitchActive: false,
              killSwitchAlreadyArmed: false,
            },
            payback: {
              status: "ready",
              reason: null,
            },
          },
          refillExecutions: [
            {
              previewStatus: "ready",
              previewBlockedReason: null,
            },
          ],
        };
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(outcome.execution, null);
  assert.equal(outcome.executionSkippedReason, "preview_not_full_green");
});

test("all-chain dry-run-first executes only after full-green preview", async () => {
  const calls = [];
  const outcome = await runAutopilotCommand(
    {
      execute: true,
      dryRunFirst: true,
    },
    {
      runner: async (args) => {
        calls.push(args);
        return {
          status: args.execute ? "completed_with_blockers" : "completed",
          blockedReason: null,
        };
      },
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].execute, false);
  assert.equal(calls[1].execute, true);
  assert.equal(outcome.mode, "dry_run_first");
  assert.equal(outcome.preview.status, "completed");
  assert.equal(outcome.execution.status, "completed_with_blockers");
  assert.equal(outcome.final, outcome.execution);
});
