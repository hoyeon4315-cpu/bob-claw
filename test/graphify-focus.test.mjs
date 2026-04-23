import assert from "node:assert/strict";
import { test } from "node:test";

import { parseArgs } from "../src/cli/graphify-focus.mjs";

test("graphify-focus parseArgs defaults to app graph query budget", () => {
  const args = parseArgs(["query", "payback", "scheduler"]);

  assert.equal(args.mode, "query");
  assert.deepEqual(args.positionals, ["payback", "scheduler"]);
  assert.equal(args.root, false);
  assert.equal(args.all, false);
  assert.equal(args.budget, 700);
  assert.equal(args.lines, 120);
});

test("graphify-focus parseArgs reads status and update flags", () => {
  const status = parseArgs(["status"]);
  const updateRoot = parseArgs(["update", "--root"]);
  const updateAll = parseArgs(["update", "--all"]);

  assert.equal(status.mode, "status");
  assert.equal(updateRoot.root, true);
  assert.equal(updateRoot.all, false);
  assert.equal(updateAll.root, false);
  assert.equal(updateAll.all, true);
});

