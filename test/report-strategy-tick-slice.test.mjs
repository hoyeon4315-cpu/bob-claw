import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function writeJsonl(path, records) {
  await mkdir(dirname(path), { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path, body ? `${body}\n` : "", "utf8");
}

test("report-strategy-tick-slice surfaces cap and gas observation state", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-strategy-tick-slice-"));
  const tickLog = join(cwd, "logs", "strategy-tick.jsonl");
  const auditLog = join(cwd, "logs", "signer-audit.jsonl");
  const outPath = join(cwd, "dashboard", "public", "strategy-tick-status.json");

  await writeJsonl(tickLog, [
    {
      schemaVersion: 1,
      tickAt: "2026-04-22T00:00:00Z",
      strategies: ["beefy-folding-vault"],
      snapshotSummary: [
        {
          strategyId: "beefy-folding-vault",
          capsConfigured: false,
          operatorAddress: "0xabc",
          gasFloatSummary: {
            configuredChainCount: 1,
            observedChainCount: 0,
            chains: [
              {
                chain: "base",
                missingReason: "actual_balance_unobserved",
              },
            ],
          },
        },
      ],
      blockers: [
        {
          strategyId: "beefy-folding-vault",
          mode: "blocked",
          blockers: ["vault_tvl_unobserved"],
        },
      ],
      dispatchSummary: {
        allowCount: 0,
        denyCount: 0,
      },
      candidateCount: 0,
    },
  ]);
  await writeJsonl(auditLog, []);

  const result = spawnSync(
    process.execPath,
    [
      join(ROOT, "src/cli/report-strategy-tick-slice.mjs"),
      `--tick-log=${tickLog}`,
      `--audit=${auditLog}`,
      `--out=${outPath}`,
      "--strategy=beefy-folding-vault",
    ],
    {
      cwd,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const slice = JSON.parse(await readFile(outPath, "utf8"));
  assert.equal(slice.summary.strategiesMissingCaps, 1);
  assert.equal(slice.strategies[0].capsConfigured, false);
  assert.equal(slice.strategies[0].operatorAddress, "0xabc");
  assert.equal(slice.strategies[0].gasFloatConfiguredChainCount, 1);
  assert.equal(slice.strategies[0].gasFloatObservedChainCount, 0);
  assert.deepEqual(slice.strategies[0].gasFloatMissingChains, [
    { chain: "base", reason: "actual_balance_unobserved" },
  ]);
});
