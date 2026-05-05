import assert from "node:assert/strict";
import { test } from "node:test";
import { runAutopilotCommand } from "../src/cli/run-all-chain-autopilot.mjs";

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
