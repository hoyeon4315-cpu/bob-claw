import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

async function seedPaybackFixture(dataDir) {
  await writeJsonl(dataDir, "receipt-reconciliations", [
    {
      observedAt: "2026-04-17T00:00:00.000Z",
      pricing: {
        btcUsd: 100_000,
      },
      realized: {
        realizedNetPnlSats: 250_000,
      },
    },
  ]);
  await writeJsonl(dataDir, "treasury-inventory", [
    {
      observedAt: "2026-04-17T00:05:00.000Z",
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
    },
  ]);
  await writeJsonl(dataDir, "market-price-snapshots", [
    {
      observedAt: "2026-04-17T00:06:00.000Z",
      btcUsd: 100_000,
      tokenByKey: { btc: 100_000, usd_stable: 1 },
      nativeByChain: { base: 2_000 },
    },
  ]);
}

test("payback status cli reports missing destination env and supports destination override preview", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-payback-cli-"));
  const dataDir = join(cwd, "data");
  await seedPaybackFixture(dataDir);

  const baseEnv = {
    ...process.env,
    BOB_CLAW_DATA_DIR: dataDir,
  };
  delete baseEnv.PAYBACK_BTC_DEST_ADDR;

  const blocked = spawnSync(
    process.execPath,
    [join(ROOT, "src/cli/report-payback-status.mjs"), "--json"],
    {
      cwd,
      env: baseEnv,
      encoding: "utf8",
    },
  );
  assert.equal(blocked.status, 0, blocked.stderr || blocked.stdout);
  const blockedReport = JSON.parse(blocked.stdout);
  assert.equal(blockedReport.payback.scheduler.status, "blocked");
  assert.equal(blockedReport.payback.scheduler.reason, "missing_destination_config");
  assert.equal(blockedReport.payback.scheduler.requiredEnvName, "PAYBACK_BTC_DEST_ADDR");
  assert.equal(blockedReport.payback.scheduler.minimumPaybackProgress.source, "after_destination");
  assert.equal(blockedReport.payback.scheduler.minimumPaybackProgress.reason, "planning_required");
  assert.equal(blockedReport.payback.scheduler.minimumPaybackProgress.satsToMinimumPayback, 0);
  assert.equal(blockedReport.payback.scheduler.previewAfterDestination.status, "plan");
  assert.equal(blockedReport.payback.scheduler.previewAfterDestination.reason, "planning_required");
  assert.equal(blockedReport.payback.scheduler.previewAfterDestination.grossTargetBeforeCostsSats, 50_000);
  assert.equal(blockedReport.payback.scheduler.previewAfterDestination.minPaybackSats, 50_000);
  assert.equal(blockedReport.payback.scheduler.previewAfterDestination.satsToMinimumPayback, 0);
  assert.equal(blockedReport.payback.scheduler.previewAfterDestination.progressToMinimumRatio, 1);
  assert.equal(blockedReport.payback.grossProfitSatsPeriod, 250_000);
  assert.equal(blockedReport.compositePreview, null);

  const preview = spawnSync(
    process.execPath,
    [
      join(ROOT, "src/cli/report-payback-status.mjs"),
      "--json",
      "--btc-destination=bc1qpayback0000000000000000000000000000000",
    ],
    {
      cwd,
      env: baseEnv,
      encoding: "utf8",
    },
  );
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  const previewReport = JSON.parse(preview.stdout);
  assert.equal(previewReport.payback.scheduler.status, "plan");
  assert.equal(previewReport.decision.status, "plan");
  assert.equal(previewReport.compositePreview.status, "blocked");
  assert.equal(previewReport.compositePreview.reason, "composite_preview_failed");
  assert.match(previewReport.compositePreview.error, /executor-signer\.sock/);
});

test("payback status cli reports current below-minimum gap when destination is already configured", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-payback-cli-low-profit-"));
  const dataDir = join(cwd, "data");
  await seedPaybackFixture(dataDir);
  await writeJsonl(dataDir, "receipt-reconciliations", [
    {
      observedAt: "2026-04-17T00:00:00.000Z",
      pricing: {
        btcUsd: 100_000,
      },
      realized: {
        realizedNetPnlSats: 289,
      },
    },
  ]);

  const result = spawnSync(
    process.execPath,
    [join(ROOT, "src/cli/report-payback-status.mjs"), "--json"],
    {
      cwd,
      env: {
        ...process.env,
        BOB_CLAW_DATA_DIR: dataDir,
        PAYBACK_BTC_DEST_ADDR: "bc1qpayback0000000000000000000000000000000",
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.payback.scheduler.status, "carry");
  assert.equal(report.payback.scheduler.reason, "planned_payback_below_minimum");
  assert.equal(report.payback.scheduler.previewAfterDestination, null);
  assert.equal(report.payback.scheduler.minimumPaybackProgress.source, "current");
  assert.equal(report.payback.scheduler.minimumPaybackProgress.reason, "planned_payback_below_minimum");
  assert.equal(report.payback.scheduler.minimumPaybackProgress.requiredGrossProfitSats, 250_000);
  assert.equal(report.payback.scheduler.minimumPaybackProgress.grossTargetBeforeCostsSats, 58);
  assert.equal(report.payback.scheduler.minimumPaybackProgress.minPaybackSats, 50_000);
  assert.equal(report.payback.scheduler.minimumPaybackProgress.satsToMinimumPayback, 49_942);
});
