import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadCanaryState, readJsonIfExists } from "../src/estimator/load-canary-state.mjs";
import { buildPriceSnapshot, emptyPricesUsd } from "../src/market/prices.mjs";

async function writeJsonl(baseDir, name, records) {
  await mkdir(baseDir, { recursive: true });
  const path = join(baseDir, `${name}.jsonl`);
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path, body ? `${body}\n` : "", "utf8");
}

test("load canary state skips live price fetch when a fresh snapshot exists", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-load-canary-fresh-"));
  const dataDir = join(cwd, "data");
  const now = "2026-04-11T12:00:00.000Z";
  await writeJsonl(dataDir, "market-price-snapshots", [
    buildPriceSnapshot(
      {
        btc: 80_000,
        tokenByKey: { btc: 80_000, wbtc: 80_000, ethereum: 3_000 },
        nativeByChain: { bob: 3_000, base: 3_000, ethereum: 3_000 },
      },
      {
        observedAt: "2026-04-11T11:58:00.000Z",
        source: "test_snapshot",
      },
    ),
  ]);

  let fetchCount = 0;
  const state = await loadCanaryState({
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    dataDir,
    now,
    getLivePrices: async () => {
      fetchCount += 1;
      return emptyPricesUsd();
    },
  });

  assert.equal(fetchCount, 0);
  assert.equal(state.prices.btc, 80_000);
});

test("load canary state falls back to live prices when snapshots are stale", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-load-canary-stale-"));
  const dataDir = join(cwd, "data");
  const now = "2026-04-11T12:00:00.000Z";
  await writeJsonl(dataDir, "market-price-snapshots", [
    buildPriceSnapshot(
      {
        btc: 79_000,
        tokenByKey: { btc: 79_000, wbtc: 79_000, ethereum: 2_900 },
        nativeByChain: { bob: 2_900, base: 2_900, ethereum: 2_900 },
      },
      {
        observedAt: "2026-04-11T11:40:00.000Z",
        source: "test_snapshot",
      },
    ),
  ]);

  let fetchCount = 0;
  const state = await loadCanaryState({
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    dataDir,
    now,
    getLivePrices: async () => {
      fetchCount += 1;
      return {
        btc: 81_000,
        tokenByKey: { btc: 81_000, wbtc: 81_000, ethereum: 3_100, usd_stable: 1, paxg: null, xaut: null },
        nativeByChain: { bob: 3_100, base: 3_100, ethereum: 3_100 },
      };
    },
  });

  assert.equal(fetchCount, 1);
  assert.equal(state.prices.btc, 81_000);
});

test("load canary state includes latest gateway route records for downstream summaries", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-load-canary-routes-"));
  const dataDir = join(cwd, "data");
  await writeJsonl(dataDir, "gateway-routes", [
    {
      observedAt: "2026-04-11T11:58:00.000Z",
      routes: [
        {
          srcChain: "ethereum",
          dstChain: "base",
          srcToken: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
          dstToken: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
        },
      ],
    },
  ]);

  const state = await loadCanaryState({
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    dataDir,
    getLivePrices: async () => emptyPricesUsd(),
  });

  assert.equal(Array.isArray(state.routesRecords), true);
  assert.equal(state.routesRecords.length, 1);
  assert.equal(state.routesRecords[0].routes[0].srcChain, "ethereum");
});

test("optional JSON reads can tolerate a concurrently written partial file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-read-json-partial-"));
  const path = join(cwd, "strategy-tick-status.json");
  await writeFile(path, '{"schemaVersion":2,', "utf8");

  const value = await readJsonIfExists(path, { tolerateMalformed: true });

  assert.equal(value, null);
});
