import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("manage-self-healing-watchdogs includes async settlement watcher", () => {
  const stdout = execFileSync(process.execPath, ["src/cli/manage-self-healing-watchdogs.mjs", "--print", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const payload = JSON.parse(stdout);
  const ids = payload.specs.map((spec) => spec.id);
  assert.ok(ids.includes("async-settlement-watcher"));
});
