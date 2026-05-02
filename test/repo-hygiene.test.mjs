import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const REQUIRED_SOURCE_HELPERS = Object.freeze([
  "src/lib/json-safe.mjs",
  "src/lib/shell-quote.mjs",
]);

function gitCheckIgnore(path) {
  return spawnSync("git", ["check-ignore", path], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

test("required imported src/lib helpers exist and are not ignored", () => {
  for (const helperPath of REQUIRED_SOURCE_HELPERS) {
    assert.equal(existsSync(helperPath), true, `${helperPath} must exist in the worktree`);
    const ignored = gitCheckIgnore(helperPath);
    assert.notEqual(
      ignored.status,
      0,
      `${helperPath} must not be ignored; fresh clones need this imported source file`,
    );
  }
});
