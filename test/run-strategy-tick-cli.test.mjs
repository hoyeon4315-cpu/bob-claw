import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  buildStrategyBuilderChainUnsupportedMarker,
  buildStrategyExecutorMissingMarker,
  validateCommittedProfileSelection,
} from "../src/cli/run-strategy-tick.mjs";

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

test("Base-specific strategy builder blocker is non-broadcastable on another chain", () => {
  const marker = buildStrategyBuilderChainUnsupportedMarker({
    alloc: {
      strategyId: "stablecoin_treasury_rotation",
      chain: "ethereum",
      protocol: "gateway",
    },
    amountUsd: 10,
    observedAt: "2026-05-02T00:00:00.000Z",
    source: "stablecoin_treasury_rotation_builder",
    supportedChain: "base",
  });

  assert.equal(marker.strategyId, "stablecoin_treasury_rotation");
  assert.equal(marker.chain, "ethereum");
  assert.equal(marker.mode, "blocked");
  assert.equal(marker.normalizationError, "strategy_builder_chain_unsupported");
  assert.equal(marker.metadata.blocker, "strategy_builder_chain_unsupported");
  assert.equal(marker.metadata.supportedChain, "base");
  assert.equal(marker.metadata.requestedChain, "ethereum");
});

test("Base-specific strategy builder blocker preserves canonical supported chain", () => {
  const marker = buildStrategyBuilderChainUnsupportedMarker({
    alloc: {
      strategyId: "destination_wrapped_btc_rotation",
      chain: "Ethereum",
      protocol: "gateway",
    },
    amountUsd: 8,
    observedAt: "2026-05-02T00:00:00.000Z",
    source: "destination_wrapped_btc_rotation_builder",
    supportedChain: "base",
  });

  assert.equal(marker.metadata.supportedChain, "base");
  assert.equal(marker.metadata.requestedChain, "Ethereum");
});

test("generic strategy fallback is a non-broadcastable executor-missing marker", () => {
  const marker = buildStrategyExecutorMissingMarker({
    alloc: {
      strategyId: "recursive_stablecoin_lending_loop",
      chain: "base",
      protocol: "morpho",
    },
    amountUsd: 5,
    observedAt: "2026-05-05T00:00:00.000Z",
    family: "lending",
  });

  assert.equal(marker.strategyId, "recursive_stablecoin_lending_loop");
  assert.equal(marker.mode, "blocked");
  assert.equal(marker.normalizationError, "strategy_executor_missing");
  assert.equal(marker.metadata.blocker, "strategy_executor_missing");
  assert.equal(marker.metadata.source, "scored_allocation");
  assert.equal(marker.intentType, undefined);
  assert.equal(marker.tx, undefined);
});

test("aggressive profile validation fails when committed non-BTC caps exceed profile matrix", () => {
  const validation = validateCommittedProfileSelection({
    profileId: "aggressive_v1",
    strategies: [
      {
        strategyId: "too-large",
        autoExecute: true,
        exposure: {
          btcDenominated: false,
        },
        caps: {
          perTxUsd: 500,
          perDayUsd: 1_000,
          tinyLivePerTxUsd: 250,
          perChainUsd: {
            base: 1_000,
          },
        },
      },
    ],
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.conflicts.length, 1);
  assert.equal(validation.conflicts[0].strategyId, "too-large");
  assert.equal(validation.conflicts[0].conflicts.some((conflict) => conflict.field === "caps.perTxUsd"), true);
});

test("aggressive profile validation passes when committed caps already fit the profile matrix", () => {
  const validation = validateCommittedProfileSelection({
    profileId: "aggressive_v1",
    strategies: [
      {
        strategyId: "aligned",
        autoExecute: true,
        exposure: {
          btcDenominated: false,
        },
        caps: {
          perTxUsd: 200,
          perDayUsd: 600,
          tinyLivePerTxUsd: 100,
          perChainUsd: {
            base: 400,
          },
        },
      },
    ],
  });

  assert.equal(validation.ok, true);
  assert.deepEqual(validation.conflicts, []);
});
