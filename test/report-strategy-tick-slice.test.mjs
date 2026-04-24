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

test("report-strategy-tick-slice joins reconciled sats profit into promotion evidence", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-strategy-tick-profit-"));
  const tickLog = join(cwd, "logs", "strategy-tick.jsonl");
  const auditLog = join(cwd, "logs", "signer-audit.jsonl");
  const reconciliationsLog = join(cwd, "data", "receipt-reconciliations.jsonl");
  const outPath = join(cwd, "dashboard", "public", "strategy-tick-status.json");
  const strategyId = "gateway_native_asset_conversion_sleeve";

  await writeJsonl(tickLog, [
    {
      schemaVersion: 1,
      tickAt: new Date().toISOString(),
      strategies: [strategyId],
      snapshotSummary: [{ strategyId, capsConfigured: true }],
      blockers: [{ strategyId, mode: "live", blockers: [] }],
      dispatchSummary: { allowCount: 0, denyCount: 0 },
      candidateCount: 0,
    },
  ]);
  await writeJsonl(auditLog, [
    {
      strategyId,
      observedAt: new Date(Date.now() - 60_000).toISOString(),
      broadcast: { txHash: "0xaaa" },
      lifecycle: { stage: "confirmed" },
    },
    {
      strategyId,
      observedAt: new Date(Date.now() - 30_000).toISOString(),
      broadcast: { txHash: "0xbbb" },
      lifecycle: { stage: "confirmed" },
    },
  ]);
  await writeJsonl(reconciliationsLog, [
    {
      txHash: "0xaaa",
      realized: { realizedNetPnlSats: 120 },
    },
    {
      txHash: "0xbbb",
      realized: { realizedNetPnlSats: 130 },
    },
  ]);

  const result = spawnSync(
    process.execPath,
    [
      join(ROOT, "src/cli/report-strategy-tick-slice.mjs"),
      `--tick-log=${tickLog}`,
      `--audit=${auditLog}`,
      `--reconciliations=${reconciliationsLog}`,
      `--out=${outPath}`,
      `--strategy=${strategyId}`,
    ],
    {
      cwd,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const slice = JSON.parse(await readFile(outPath, "utf8"));
  const row = slice.strategies[0];
  assert.equal(row.strategyId, strategyId);
  assert.equal(row.receiptCountSignerBacked, 2);
  assert.equal(row.promotion.fastTrack.eligible, true);
  assert.equal(row.liveEligibility.liveEligible, true);
  assert.equal(slice.summary.strategiesEligibleFastTrack, 1);
  assert.equal(slice.summary.strategiesLiveEligible, 1);
});

test("report-strategy-tick-slice excludes operator-held wrapped BTC loop from live eligible count", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-strategy-tick-hold-"));
  const tickLog = join(cwd, "logs", "strategy-tick.jsonl");
  const auditLog = join(cwd, "logs", "signer-audit.jsonl");
  const outPath = join(cwd, "dashboard", "public", "strategy-tick-status.json");
  const strategyId = "wrapped-btc-loop-base-moonwell";
  const now = Date.now();

  await writeJsonl(tickLog, [
    {
      schemaVersion: 1,
      tickAt: new Date(now).toISOString(),
      strategies: [strategyId],
      reportSummaries: [
        {
          strategyId,
          mode: "live_candidate",
          blockerCount: 0,
          blockers: [],
        },
      ],
      snapshotSummary: [{ strategyId, capsConfigured: true }],
      blockers: [{ strategyId, mode: "live_candidate", blockers: [] }],
      dispatchSummary: { allowCount: 0, denyCount: 0 },
      candidateCount: 0,
    },
  ]);
  await writeJsonl(auditLog, [
    {
      strategyId,
      observedAt: new Date(now - 60_000).toISOString(),
      broadcast: { txHash: "0x111" },
      lifecycle: { stage: "confirmed" },
    },
    {
      strategyId,
      observedAt: new Date(now - 30_000).toISOString(),
      broadcast: { txHash: "0x222" },
      lifecycle: { stage: "confirmed" },
    },
  ]);

  const result = spawnSync(
    process.execPath,
    [
      join(ROOT, "src/cli/report-strategy-tick-slice.mjs"),
      `--tick-log=${tickLog}`,
      `--audit=${auditLog}`,
      `--out=${outPath}`,
      `--strategy=${strategyId}`,
    ],
    {
      cwd,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const slice = JSON.parse(await readFile(outPath, "utf8"));
  const row = slice.strategies[0];
  assert.equal(row.promotion.fastTrack.eligible, true);
  assert.equal(row.operatorHold, true);
  assert.equal(row.autoExecute, false);
  assert.equal(row.liveEligibility.liveEligible, false);
  assert.equal(row.liveEligibility.blockers.includes("strategy_auto_execute_disabled"), true);
  assert.equal(row.liveEligibility.blockers.includes("operator_hold"), true);
  assert.equal(slice.summary.strategiesEligibleFastTrack, 1);
  assert.equal(slice.summary.strategiesLiveEligible, 0);
  assert.equal(slice.summary.strategiesOperatorHold, 1);
  assert.equal(slice.strategyStage.liveReadyCount, 0);
});
