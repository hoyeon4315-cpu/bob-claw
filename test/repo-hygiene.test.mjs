import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const REQUIRED_SOURCE_HELPERS = Object.freeze([
  "src/lib/json-safe.mjs",
  "src/lib/shell-quote.mjs",
]);

/**
 * @param {string} path
 */
function gitCheckIgnore(path) {
  return spawnSync("git", ["check-ignore", path], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

/**
 * @param {string} path
 */
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

test("repository exposes strict TypeScript checking for JavaScript ESM source", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(packageJson.scripts?.typecheck, "tsc --project tsconfig.json --noEmit");
  assert.match(packageJson.devDependencies?.typescript || "", /^\^?\d+\.\d+\.\d+/u);

  const tsconfig = JSON.parse(await readFile("tsconfig.json", "utf8"));
  assert.equal(tsconfig.compilerOptions?.strict, true);
  assert.equal(tsconfig.compilerOptions?.checkJs, true);
  assert.equal(tsconfig.compilerOptions?.allowJs, true);
  assert.equal(tsconfig.compilerOptions?.noEmit, true);
  const includedPaths = /** @type {string[]} */ (tsconfig.include || []);
  assert.ok(includedPaths.some((pattern) => pattern.startsWith("src/")), "type checker must cover real source files");
});

const LIVE_RAW_KEY_FORBIDDEN_FILES = Object.freeze([
  "src/cli/deploy-and-configure.mjs",
  "src/cli/deploy-check-key.mjs",
  "src/cli/trigger-triangular-arb.mjs",
  "src/cli/run-btc-address-migrate.mjs",
  "src/cli/auto-canary.sh",
  "src/cli/canary-live.sh",
  "src/cli/deploy-interactive.sh",
  "src/cli/fix-min-profit.sh",
  "src/cli/lower-min-profit.sh",
]);

test("legacy live CLIs do not accept raw private keys or direct cast/forge sends", async () => {
  const forbidden =
    /\bPRIVATE_KEY\b|--private-key\b|cast\s+send|forge\s+create|createBtcLocalKeySigner|signIntent|broadcastSignedIntent/u;
  for (const sourcePath of LIVE_RAW_KEY_FORBIDDEN_FILES) {
    const source = await readFile(sourcePath, "utf8");
    assert.equal(forbidden.test(source), false, `${sourcePath} must route live actions through signer daemon policy`);
  }
});
