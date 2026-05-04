import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { parseArgs, runAutopilotCommand } from "../src/cli/run-all-chain-autopilot.mjs";

test("all-chain autopilot cli parses dry-run-first operator flag", () => {
  const args = parseArgs(["--execute", "--dry-run-first", "--json", "--chains=base,bsc"]);
  assert.equal(args.execute, true);
  assert.equal(args.dryRunFirst, true);
  assert.equal(args.json, true);
  assert.deepEqual(args.chains, ["base", "bsc"]);
});

test("all-chain autopilot cli runs preview before execute when dry-run-first is requested", async () => {
  const calls = [];
  const runner = async (args) => {
    calls.push({ execute: args.execute, dryRunFirst: args.dryRunFirst });
    return {
      status: args.execute ? "completed" : "completed_with_blockers",
      mode: args.execute ? "execute" : "preview",
    };
  };

  const outcome = await runAutopilotCommand({
    execute: true,
    dryRunFirst: true,
    json: false,
    loop: false,
  }, { runner });

  assert.equal(outcome.mode, "dry_run_first");
  assert.equal(outcome.preview?.mode, "preview");
  assert.equal(outcome.execution?.mode, "execute");
  assert.equal(outcome.final?.mode, "execute");
  assert.deepEqual(calls, [
    { execute: false, dryRunFirst: true },
    { execute: true, dryRunFirst: true },
  ]);
});

test("all-chain autopilot cli skips execute pass when dry-run-first preview errors", async () => {
  const calls = [];
  const outcome = await runAutopilotCommand({
    execute: true,
    dryRunFirst: true,
    json: false,
    loop: false,
  }, {
    runner: async (args) => {
      calls.push({ execute: args.execute });
      return {
        status: "error",
        mode: args.execute ? "execute" : "preview",
      };
    },
  });

  assert.equal(outcome.mode, "dry_run_first");
  assert.equal(outcome.preview?.mode, "preview");
  assert.equal(outcome.execution, null);
  assert.equal(outcome.final?.status, "error");
  assert.deepEqual(calls, [{ execute: false }]);
});

test("package exposes autopilot all-chains script alias", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["autopilot:all-chains"], "node src/cli/run-all-chain-autopilot.mjs");
});
