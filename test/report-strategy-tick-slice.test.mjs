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

test("report-strategy-tick-slice keeps receipts separate from policy live eligibility", async () => {
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
      marketRegime: "bear",
    },
    {
      txHash: "0xbbb",
      realized: { realizedNetPnlSats: 130 },
      regime: "neutral",
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
  assert.deepEqual(row.regimeBreakdown, {
    bear: { receipts: 1, realizedNetBtc: 0.0000012 },
    neutral: { receipts: 1, realizedNetBtc: 0.0000013 },
  });
  assert.equal(row.policyReadiness.signerBackedReceiptCount, 2);
  assert.equal(row.liveEligibility.liveEligible, true);
  assert.equal(slice.summary.strategiesLiveEligible, 1);
});

test("report-strategy-tick-slice includes reopened wrapped BTC loop in live eligible count", async () => {
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
  assert.equal(row.operatorHold, false);
  assert.equal(row.autoExecute, true);
  assert.equal(row.policyReadiness.capAutoExecute, true);
  assert.equal(row.liveEligibility.liveEligible, true);
  assert.equal(row.liveEligibility.blockers.includes("strategy_auto_execute_disabled"), false);
  assert.equal(row.liveEligibility.blockers.includes("operator_hold"), false);
  assert.equal(slice.summary.strategiesLiveEligible, 1);
  assert.equal(slice.summary.strategiesOperatorHold, 0);
  assert.equal(slice.strategyStage.liveReadyCount, 1);
});

test("report-strategy-tick-slice derives micro-canary status from canary execution ledgers", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-strategy-tick-canary-"));
  const tickLog = join(cwd, "logs", "strategy-tick.jsonl");
  const auditLog = join(cwd, "logs", "signer-audit.jsonl");
  const canaryLog = join(cwd, "data", "merkl-canary-autopilot-runs.jsonl");
  const outPath = join(cwd, "dashboard", "public", "strategy-tick-status.json");
  const strategyId = "gateway_native_asset_conversion_sleeve";
  const now = Date.now();

  await writeJsonl(tickLog, [
    {
      schemaVersion: 1,
      tickAt: new Date(now).toISOString(),
      strategies: [strategyId],
      reportSummaries: [
        {
          strategyId,
          mode: "live",
          microCanaryStatus: "not_started",
          evidence: { signerBackedCount: 0, passedCount: 0 },
        },
      ],
      snapshotSummary: [{ strategyId, capsConfigured: true }],
      blockers: [{ strategyId, mode: "live", blockers: [] }],
      dispatchSummary: { allowCount: 0, denyCount: 0 },
      candidateCount: 0,
    },
  ]);
  await writeJsonl(auditLog, []);
  await writeJsonl(canaryLog, [
    {
      observedAt: new Date(now - 60_000).toISOString(),
      mode: "execute",
      status: "delivered",
      plan: { strategyId },
      queueItem: { mappedStrategyId: strategyId },
      execution: {
        settlementStatus: "delivered",
        receiptIngest: {
          receiptRecord: {
            realized: { realizedNetPnlUsd: 0.12 },
          },
        },
      },
    },
  ]);

  const result = spawnSync(
    process.execPath,
    [
      join(ROOT, "src/cli/report-strategy-tick-slice.mjs"),
      `--tick-log=${tickLog}`,
      `--audit=${auditLog}`,
      `--canary-log=${canaryLog}`,
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
  const micro = slice.microCanary.byStrategy[strategyId];
  assert.equal(micro.microCanaryStatus, "minimal_live_proof_exists");
  assert.equal(micro.signerBackedCount, 1);
  assert.equal(micro.passedCount, 1);
  assert.equal(micro.realizedNetUsd, 0.12);
  assert.equal(slice.microCanary.notStartedCount, 0);
  assert.equal(slice.microCanary.minimalLiveProofExistsCount, 1);
});

test("report-strategy-tick-slice v3 counts dispatcher deny reasons by strategy", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-strategy-tick-deny-"));
  const tickLog = join(cwd, "logs", "strategy-tick.jsonl");
  const auditLog = join(cwd, "logs", "signer-audit.jsonl");
  const outPath = join(cwd, "dashboard", "public", "strategy-tick-status.json");
  const strategyId = "beefy-folding-vault";

  await writeJsonl(tickLog, [
    {
      schemaVersion: 1,
      tickAt: "2026-05-08T00:00:00.000Z",
      strategies: [strategyId, "other-strategy"],
      snapshotSummary: [{ strategyId, capsConfigured: true }],
      blockers: [
        {
          strategyId,
          mode: "live_candidate",
          blockers: ["same_chain_unprofitable:need_$5_on_base"],
        },
      ],
      dispatchSummary: { allowCount: 1, denyCount: 4 },
      dispatchIntents: [
        { strategyId, chain: "base", decision: "deny", reason: "negative_post_cost_edge" },
        { strategyId, chain: "bsc", decision: "deny", reason: "feed_stale" },
        { strategyId, chain: "bsc", decision: "deny", reason: "feed_stale" },
        { strategyId, chain: "base", decision: "allow", reason: null },
        { strategyId: "other-strategy", chain: "bsc", decision: "deny", reason: "feed_stale" },
      ],
      builder: {
        skipped: [
          { strategyId, reason: "adapter_blocked" },
          { strategyId, reason: "same_chain_unprofitable:need_$5_on_base" },
          { strategyId: "other-strategy", reason: "adapter_blocked" },
        ],
      },
      candidateCount: 1,
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

  assert.equal(slice.schemaVersion, 3);
  assert.deepEqual(row.lastTickDenyByReason, {
    negative_post_cost_edge: 1,
    feed_stale: 2,
  });
  assert.equal(row.topDenyReason, "feed_stale");
  assert.deepEqual(row.lastTickAllowByChain, { base: 1 });
  assert.deepEqual(row.lastTickDenyByChain, { base: 1, bsc: 2 });
  assert.deepEqual(row.lastTickSkippedByReason, {
    adapter_blocked: 1,
    same_chain_unprofitable: 1,
  });
  assert.equal(row.topBlocker, "same_chain_unprofitable:need_$5_on_base");
  assert.equal(row.topBlockerCode, "same_chain_unprofitable");
  assert.deepEqual(row.blockerCountByCategory, {
    adapter: 1,
    ev: 2,
    freshness: 2,
  });
  assert.equal(row.chainScoreSource, null);
  assert.equal(row.chainScoreObservedAt, null);
  assert.equal(row.generatedIntentCount, 0);
});

test("report-strategy-tick-slice exposes chain score provenance when present", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-strategy-tick-chain-score-"));
  const tickLog = join(cwd, "logs", "strategy-tick.jsonl");
  const auditLog = join(cwd, "logs", "signer-audit.jsonl");
  const outPath = join(cwd, "dashboard", "public", "strategy-tick-status.json");
  const strategyId = "beefy-folding-vault";

  await writeJsonl(tickLog, [
    {
      schemaVersion: 1,
      tickAt: "2026-05-08T00:00:00.000Z",
      strategies: [strategyId],
      snapshotSummary: [{ strategyId, capsConfigured: true }],
      blockers: [{ strategyId, mode: "live_candidate", blockers: [] }],
      dispatchSummary: { allowCount: 1, denyCount: 0 },
      candidateCount: 1,
      scoredAllocationDetails: [
        {
          strategyId,
          chain: "base",
          score: 0.7,
          chainScoreSource: "ledger",
          chainScoreObservedAt: "2026-05-08T00:00:00.000Z",
        },
      ],
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
      `--strategy=${strategyId}`,
    ],
    {
      cwd,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const row = JSON.parse(await readFile(outPath, "utf8")).strategies[0];
  assert.equal(row.chainScoreSource, "ledger");
  assert.equal(row.chainScoreObservedAt, "2026-05-08T00:00:00.000Z");
});
