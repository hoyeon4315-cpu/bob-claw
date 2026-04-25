import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { formatPlanValue } from "../src/cli/plan-treasury-actions.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function writeJsonl(baseDir, name, records) {
  await mkdir(baseDir, { recursive: true });
  const path = join(baseDir, `${name}.jsonl`);
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path, body ? `${body}\n` : "", "utf8");
}

test("plan treasury actions uses stored inventory snapshot by default", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-plan-"));
  const dataDir = join(cwd, "data");

  await writeJsonl(dataDir, "treasury-inventory", [
    {
      observedAt: "2026-04-11T03:00:00.000Z",
      address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
      supportedChains: ["bob", "base"],
      activeChains: ["bob", "base"],
      native: [
        {
          chain: "base",
          active: true,
          enabled: true,
          asset: "ETH",
          token: "0x0000000000000000000000000000000000000000",
          actual: "1000000000000000",
          actualDecimal: 0.001,
          targetBalance: "4000000000000000",
          targetBalanceDecimal: 0.004,
          refillToTarget: "3000000000000000",
          refillToTargetDecimal: 0.003,
          priceUsd: 2200,
          estimatedUsd: 2.2,
          status: "refill_required",
          rationale: "Base gas",
        },
      ],
      tokens: [],
      allowances: [],
      summary: {
        estimatedWalletUsd: 25,
      },
    },
  ]);

  const result = spawnSync(process.execPath, [join(ROOT, "src/cli/plan-treasury-actions.mjs"), "--json"], {
    cwd,
    env: {
      ...process.env,
      BOB_CLAW_DATA_DIR: dataDir,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.inventorySource, "stored_snapshot");
  assert.equal(output.actions[0].type, "refill_native");
  assert.equal(Math.abs(output.actions[0].refillEstimatedUsd - 6.6) < 1e-9, true);
  assert.equal(output.summary.noDemandBlockerCount, 0);
});

test("plan treasury output formatter guards non-finite values", () => {
  assert.equal(formatPlanValue(1.23456, { digits: 4 }), "1.2346");
  assert.equal(formatPlanValue(Infinity, { digits: 4 }), "n/a");
  assert.equal(formatPlanValue(NaN), "n/a");
});
