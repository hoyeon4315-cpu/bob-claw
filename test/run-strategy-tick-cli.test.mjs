import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

test("run-strategy-tick reports committed cap configuration without fabricating gas floats", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-run-strategy-tick-"));
  const dataDir = join(cwd, "data");
  const snapshotDir = join(dataDir, "snapshots");
  const outPath = join(cwd, "strategy-tick.jsonl");

  await mkdir(snapshotDir, { recursive: true });
  await writeJsonl(dataDir, "gas-snapshots", [
    {
      observedAt: "2026-04-22T00:00:00Z",
      chain: "base",
      nativeUsd: 3000,
      gasPriceWei: "1000000000",
      fallbackGasUnits: 21000,
    },
  ]);

  const result = spawnSync(
    process.execPath,
    [
      join(ROOT, "src/cli/run-strategy-tick.mjs"),
      "--strategy=beefy-folding-vault",
      "--json",
      `--data-dir=${dataDir}`,
      `--snapshot-dir=${snapshotDir}`,
      `--out=${outPath}`,
    ],
    {
      cwd,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const summary = payload.tickRecord.snapshotSummary[0];
  assert.equal(summary.strategyId, "beefy-folding-vault");
  assert.equal(summary.capsConfigured, true);
  assert.equal(summary.gasFloatSummary.configuredChainCount, 1);
  assert.equal(summary.gasFloatSummary.observedChainCount, 0);
  assert.equal(summary.gasFloatSummary.chains[0].chain, "bsc");
  assert.equal(summary.gasFloatSummary.chains[0].missingReason, "actual_balance_unobserved");
});
