import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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

function gitLsFiles(path) {
  return spawnSync("git", ["ls-files", "--error-unmatch", path], {
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
    const tracked = gitLsFiles(helperPath);
    assert.equal(
      tracked.status,
      0,
      `${helperPath} must be tracked; fresh clones cannot rely on local-only helper files`,
    );
  }
});

const LIVE_RAW_KEY_FORBIDDEN_FILES = Object.freeze([
  "src/cli/deploy-and-configure.mjs",
  "src/cli/deploy-check-key.mjs",
  "src/cli/trigger-triangular-arb.mjs",
]);

test("legacy live CLIs do not accept raw private keys or direct cast/forge sends", async () => {
  const forbidden = /\bPRIVATE_KEY\b|--private-key\b|cast\s+send|forge\s+create/u;
  for (const sourcePath of LIVE_RAW_KEY_FORBIDDEN_FILES) {
    const source = await readFile(sourcePath, "utf8");
    assert.equal(forbidden.test(source), false, `${sourcePath} must route live actions through signer daemon policy`);
  }
});
