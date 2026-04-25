import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDotEnvCandidates, resolveDotEnvCandidatePaths } from "../src/config/env.mjs";

test("resolveDotEnvCandidatePaths prefers cwd and repo root without duplicates", () => {
  const cwd = "/tmp/example";
  const repoEnvPath = resolve(fileURLToPath(new URL("../.env", import.meta.url)));
  const paths = resolveDotEnvCandidatePaths({
    cwd,
    moduleUrl: new URL("../src/config/env.mjs", import.meta.url).href,
  });

  assert.equal(paths[0], resolve(cwd, ".env"));
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.includes(repoEnvPath));
});

test("loadDotEnvCandidates falls back to repo root dotenv when cwd file is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bobclaw-env-"));
  const fakeModulePath = join(dir, "src", "config", "env.mjs");
  const repoEnvPath = join(dir, ".env");
  const env = {};

  await mkdir(join(dir, "src", "config"), { recursive: true });
  await writeFile(fakeModulePath, "// test helper\n", "utf8");
  await writeFile(repoEnvPath, "PAYBACK_BTC_DEST_ADDR=bc1ptest\nBURNER_EVM_KEY_PATH=/tmp/evm.key\n", "utf8");
  loadDotEnvCandidates({
    cwd: join(dir, "missing-cwd"),
    moduleUrl: pathToFileURL(fakeModulePath).href,
    env,
  });

  assert.equal(env.PAYBACK_BTC_DEST_ADDR, "bc1ptest");
  assert.equal(env.BURNER_EVM_KEY_PATH, "/tmp/evm.key");

  await rm(dir, { recursive: true, force: true });
});
