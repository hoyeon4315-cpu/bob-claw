import assert from "node:assert/strict";
import test from "node:test";

import { ensureExecutionGuardsAllow } from "../src/cli/run-refill-job-stub.mjs";

test("refill job stub skips execution guards in preview mode", async () => {
  let called = false;
  const guards = await ensureExecutionGuardsAllow({
    execute: false,
    mode: "dry_run",
    readExecutionGuardsImpl: async () => {
      called = true;
      return { blocked: true, reasons: ["kill_switch_active"] };
    },
  });

  assert.equal(called, false);
  assert.deepEqual(guards, { blocked: false, reasons: [] });
});

test("refill job stub still enforces execution guards in execute mode", async () => {
  let called = false;
  const guards = await ensureExecutionGuardsAllow({
    execute: true,
    mode: "execute",
    readExecutionGuardsImpl: async (args) => {
      called = true;
      assert.equal(args.mode, "execute");
      return { blocked: true, reasons: ["kill_switch_active"] };
    },
  });

  assert.equal(called, true);
  assert.deepEqual(guards, { blocked: true, reasons: ["kill_switch_active"] });
});
