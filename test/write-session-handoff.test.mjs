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
  await writeFile(
    join(dataDir, "wrapped-btc-loop-base-moonwell-auto-unwind-runtime-latest.json"),
    `${JSON.stringify({
      strategy: { id: "wrapped-btc-loop-base-moonwell", label: "Wrapped BTC lending loop (Base / Moonwell)", chain: "base", protocol: "moonwell" },
      runtime: { status: "healthy", severity: "info", triggerCount: 0 },
      watcherDecision: { triggers: [] },
      emergencyUnwindExecution: { status: "standby", actions: new Array(9).fill({}) },
      nextAction: { code: "continue_monitoring" },
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(dataDir, "recursive_wrapped_btc_lending_loop-auto-unwind-runtime-latest.json"),
    `${JSON.stringify({
      strategy: { id: "recursive_wrapped_btc_lending_loop", label: "Recursive wrapped-BTC lending loop", chain: "base", protocol: "moonwell" },
      runtime: { status: "pause_new_entries", severity: "warning", triggerCount: 1 },
      watcherDecision: { triggers: ["unwind_gas_above_budget"] },
      emergencyUnwindExecution: { status: "standby", actions: new Array(9).fill({}) },
      nextAction: { code: "pause_new_entries_and_review" },
    }, null, 2)}\n`,
    "utf8",
  );

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
  assert.match(doc, /Gas freshness: missing=\d+ stale=\d+ staleChains=`.*`/);
  assert.match(doc, /Research board: candidates=\d+ top=`.*` newTop=`.*` nextNew=`.*`/);
  assert.match(doc, /Product coverage: ready=\d+ inProgress=\d+ blocked=\d+ missing=\d+ topGap=`.*` reason=`.*`/);
  assert.match(doc, /Formula audit: implemented=\d+ partial=\d+ missing=\d+ topGap=`.*`/);
  assert.match(doc, /Advanced validation lane: passed=\d+\/\d+ topBlocked=`.*` blockers=.* next=`.*`/);
  assert.match(doc, /Auto-unwind runtime: count=\d+ top=`.*` status=`.*` triggers=.* next=`.*`/);
  assert.match(doc, /## Live Baseline/);
  assert.match(doc, /Blocker counts: refreshInputs=\d+ operator=\d+ technical=\d+ objective=\d+ total=\d+/);
  assert.match(doc, /Operator blocker: status=`missing_destination_config` env=`PAYBACK_BTC_DEST_ADDR` next=`set_payback_btc_destination_env`/);
  assert.match(doc, /## Payback Readiness/);
  assert.match(doc, /Scheduler: status=`blocked` reason=`missing_destination_config` next=`set_payback_btc_destination_env`/);
  assert.match(doc, /Required env: `PAYBACK_BTC_DEST_ADDR`/);
  assert.match(doc, /After destination is set: status=`carry` reason=`planned_payback_below_minimum` grossTarget=`50 sats` minPayback=`50,000 sats` remaining=`49,950 sats` progress=`0.10%`/);
  assert.match(doc, /Preview command: `npm run report:payback-status -- --json`/);
});
