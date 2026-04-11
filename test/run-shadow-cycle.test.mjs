import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function writeJsonl(baseDir, name, records) {
  await mkdir(baseDir, { recursive: true });
  const path = join(baseDir, `${name}.jsonl`);
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path, body ? `${body}\n` : "", "utf8");
}

test("run shadow cycle skips rewriting when only observedAt changes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-shadow-cycle-"));
  const dataDir = join(cwd, "data");

  await writeJsonl(dataDir, "treasury-inventory", [
    {
      observedAt: "2026-04-11T02:03:25.161Z",
      address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
      supportedChains: ["bob"],
      activeChains: ["bob"],
      native: [],
      tokens: [],
      allowances: [],
      summary: {
        estimatedWalletUsd: 25.01,
      },
    },
  ]);

  const first = spawnSync(process.execPath, [join(ROOT, "src/cli/run-shadow-cycle.mjs"), "--write"], {
    cwd,
    env: {
      ...process.env,
      BOB_CLAW_DATA_DIR: dataDir,
    },
    encoding: "utf8",
  });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.match(first.stdout, /wrote=.*shadow-cycle-latest\.json/);

  const second = spawnSync(process.execPath, [join(ROOT, "src/cli/run-shadow-cycle.mjs"), "--write"], {
    cwd,
    env: {
      ...process.env,
      BOB_CLAW_DATA_DIR: dataDir,
    },
    encoding: "utf8",
  });
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.match(second.stdout, /unchanged=.*shadow-cycle-latest\.json/);

  const summary = JSON.parse(await readFile(join(dataDir, "shadow-cycle-latest.json"), "utf8"));
  assert.equal(typeof summary.mode, "string");
});
