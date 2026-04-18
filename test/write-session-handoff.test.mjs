import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { WBTC_OFT_TOKEN } from "../src/assets/tokens.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function writeJsonl(baseDir, name, records) {
  await mkdir(baseDir, { recursive: true });
  await writeFile(
    join(baseDir, `${name}.jsonl`),
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8",
  );
}

test("write-session-handoff includes payback readiness summary and preview command", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-handoff-"));
  const dataDir = join(cwd, "data");
  await mkdir(join(cwd, "docs"), { recursive: true });

  await writeJsonl(dataDir, "treasury-inventory", [
    {
      observedAt: "2026-04-17T12:00:00.000Z",
      address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
      native: [],
      tokens: [
        {
          chain: "base",
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          actual: "250000",
          actualDecimal: 0.0025,
          priceUsd: 100_000,
        },
      ],
      allowances: [],
      summary: {
        estimatedWalletUsd: 250,
      },
    },
  ]);
  await writeJsonl(dataDir, "receipt-reconciliations", [
    {
      observedAt: "2026-04-17T12:05:00.000Z",
      pricing: {
        btcUsd: 100_000,
      },
      realized: {
        realizedNetPnlSats: 250,
      },
    },
  ]);
  await writeJsonl(dataDir, "market-price-snapshots", [
    {
      observedAt: "2026-04-17T12:06:00.000Z",
      btcUsd: 100_000,
      tokenByKey: { btc: 100_000, usd_stable: 1 },
      nativeByChain: { base: 2_000 },
    },
  ]);

  const result = spawnSync(process.execPath, [join(ROOT, "src/cli/write-session-handoff.mjs")], {
    cwd,
    env: {
      ...process.env,
      BOB_CLAW_DATA_DIR: dataDir,
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const doc = await readFile(join(cwd, "docs/current-status.md"), "utf8");
  assert.match(doc, /Research board: candidates=\d+ top=`.*` newTop=`.*` nextNew=`.*`/);
  assert.match(doc, /Advanced validation lane: passed=\d+\/\d+ topBlocked=`.*` blockers=.* next=`.*`/);
  assert.match(doc, /## Live Baseline/);
  assert.match(doc, /Blocker counts: refreshInputs=\d+ operator=\d+ technical=\d+ objective=\d+ total=\d+/);
  assert.match(doc, /Operator blocker: status=`payback_destination_env_missing` env=`PAYBACK_BTC_DEST_ADDR` next=`set_payback_btc_destination_env`/);
  assert.match(doc, /## Payback Readiness/);
  assert.match(doc, /Scheduler: status=`blocked` reason=`payback_btc_destination_missing` next=`set_payback_btc_destination_env`/);
  assert.match(doc, /Required env: `PAYBACK_BTC_DEST_ADDR`/);
  assert.match(doc, /After destination is set: status=`carry` reason=`planned_payback_below_minimum` grossTarget=`50 sats` minPayback=`50,000 sats` remaining=`49,950 sats` progress=`0.10%`/);
  assert.match(doc, /Preview command: `npm run report:payback-status -- --json`/);
});
