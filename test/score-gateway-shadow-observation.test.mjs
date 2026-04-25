import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ZERO_TOKEN = "0x0000000000000000000000000000000000000000";
const WBTC_OFT = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

async function writeJsonl(baseDir, name, records) {
  await mkdir(baseDir, { recursive: true });
  const path = join(baseDir, `${name}.jsonl`);
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path, body ? `${body}\n` : "", "utf8");
}

function quote({ observedAt, route, amount = "10000", inputAmount = "10000", outputAmount = "10020" }) {
  return {
    observedAt,
    route,
    routeKey: `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`,
    quoteType: "layerZero",
    amount,
    inputAmount,
    outputAmount,
    txValueWei: "0",
    estimatedTimeInSecs: 60,
    latencyMs: 100,
  };
}

test("score gateway appends shadow observations only when the observation changes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-shadow-observation-"));
  const dataDir = join(cwd, "data");
  const now = Date.now();
  const iso = (offsetMs) => new Date(now + offsetMs).toISOString();
  const route = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const routeKey = `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`;

  await writeJsonl(dataDir, "gateway-quotes", [quote({ observedAt: iso(-60_000), route })]);
  await writeJsonl(dataDir, "gateway-quote-failures", []);
  await writeJsonl(dataDir, "dex-quotes", []);
  await writeJsonl(dataDir, "bitcoin-fee-snapshots", [{ observedAt: iso(-60_000), btcUsd: 50_000 }]);
  await writeJsonl(dataDir, "gateway-gas-estimates", [
    {
      observedAt: iso(-50_000),
      routeKey,
      amount: "10000",
      estimatedGasUsd: 0.001,
    },
  ]);
  await writeJsonl(dataDir, "gas-snapshots", [
    {
      observedAt: iso(-50_000),
      chain: "bob",
      nativeUsd: 3_000,
      gasPriceWei: "1000000000",
      fallbackGasUnits: 21000,
    },
    {
      observedAt: iso(-50_000),
      chain: "base",
      nativeUsd: 3_000,
      gasPriceWei: "1000000000",
      fallbackGasUnits: 21000,
    },
  ]);
  await writeJsonl(dataDir, "market-price-snapshots", [
    {
      schemaVersion: 1,
      observedAt: iso(-30_000),
      source: "test",
      btcUsd: 50_000,
      tokenByKey: {
        btc: 50_000,
        wbtc: 50_000,
        ethereum: 3_000,
        usd_stable: 1,
      },
      nativeByChain: {
        bob: 3_000,
        base: 3_000,
        ethereum: 3_000,
      },
    },
  ]);
  await writeJsonl(dataDir, "treasury-inventory", [
    {
      schemaVersion: 1,
      observedAt: iso(-120_000),
      address: "0xabc",
      supportedChains: ["bob", "base"],
      activeChains: ["bob", "base"],
      native: [
        {
          chain: "bob",
          asset: "ETH",
          token: ZERO_TOKEN,
          actual: "0",
          actualDecimal: 0,
          targetBalance: "5000000000000000",
          targetBalanceDecimal: 0.005,
          refillToTarget: "5000000000000000",
          refillToTargetDecimal: 0.005,
          priceUsd: 3_000,
          estimatedUsd: 0,
          status: "refill_required",
          rationale: "test",
        },
        {
          chain: "base",
          asset: "ETH",
          token: ZERO_TOKEN,
          actual: "5000000000000000",
          actualDecimal: 0.005,
          targetBalance: "4000000000000000",
          targetBalanceDecimal: 0.004,
          refillToTarget: "0",
          refillToTargetDecimal: 0,
          priceUsd: 3_000,
          estimatedUsd: 15,
          status: "ready",
          rationale: "test",
        },
      ],
      tokens: [
        {
          chain: "bob",
          token: WBTC_OFT,
          ticker: "wBTC.OFT",
          actual: "0",
          actualDecimal: 0,
          targetBalance: "30000",
          targetBalanceDecimal: 0.0003,
          refillToTarget: "30000",
          refillToTargetDecimal: 0.0003,
          priceUsd: 50_000,
          estimatedUsd: 0,
          status: "refill_required",
          rationale: "test",
        },
      ],
      allowances: [],
      summary: {
        estimatedWalletUsd: 15,
      },
    },
  ]);

  const first = spawnSync(process.execPath, [join(ROOT, "src/cli/score-gateway.mjs"), "--write"], {
    cwd,
    env: {
      ...process.env,
      BOB_CLAW_DATA_DIR: dataDir,
    },
    encoding: "utf8",
  });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.match(first.stdout, /shadowObservations=1/);

  const second = spawnSync(process.execPath, [join(ROOT, "src/cli/score-gateway.mjs"), "--write"], {
    cwd,
    env: {
      ...process.env,
      BOB_CLAW_DATA_DIR: dataDir,
    },
    encoding: "utf8",
  });
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.match(second.stdout, /shadowObservations=0/);

  const snapshot = JSON.parse(await readFile(join(dataDir, "gateway-scores.json"), "utf8"));
  assert.equal(snapshot.scores.length, 1);
  assert.equal(Number.isFinite(snapshot.scores[0].treasuryExecutionRefillCostUsd), true);

  const observations = (await readFile(join(dataDir, "gateway-shadow-observations.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(observations.length, 1);
  assert.equal(observations[0].tradeable, false);
  assert.equal(observations[0].routeKey, routeKey);
  assert.equal(Number.isFinite(observations[0].treasuryExecutionRefillCostUsd), true);
});

test("score gateway can force an unchanged shadow observation append for decay checkpoints", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-shadow-observation-rollover-"));
  const dataDir = join(cwd, "data");
  const now = Date.now();
  const iso = (offsetMs) => new Date(now + offsetMs).toISOString();
  const route = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const routeKey = `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`;

  await writeJsonl(dataDir, "gateway-quotes", [quote({ observedAt: iso(-60_000), route })]);
  await writeJsonl(dataDir, "gateway-quote-failures", []);
  await writeJsonl(dataDir, "dex-quotes", []);
  await writeJsonl(dataDir, "bitcoin-fee-snapshots", [{ observedAt: iso(-60_000), btcUsd: 50_000 }]);
  await writeJsonl(dataDir, "gateway-gas-estimates", [
    {
      observedAt: iso(-50_000),
      routeKey,
      amount: "10000",
      estimatedGasUsd: 0.001,
    },
  ]);
  await writeJsonl(dataDir, "gas-snapshots", [
    {
      observedAt: iso(-50_000),
      chain: "bob",
      nativeUsd: 3_000,
      gasPriceWei: "1000000000",
      fallbackGasUnits: 21000,
    },
  ]);
  await writeJsonl(dataDir, "market-price-snapshots", [
    {
      schemaVersion: 1,
      observedAt: iso(-30_000),
      source: "test",
      btcUsd: 50_000,
      tokenByKey: {
        btc: 50_000,
        wbtc: 50_000,
        ethereum: 3_000,
        usd_stable: 1,
      },
      nativeByChain: {
        bob: 3_000,
        base: 3_000,
        ethereum: 3_000,
      },
    },
  ]);
  await writeJsonl(dataDir, "treasury-inventory", [
    {
      schemaVersion: 1,
      observedAt: iso(-120_000),
      address: "0xabc",
      supportedChains: ["bob", "base"],
      activeChains: ["bob", "base"],
      native: [],
      tokens: [],
      allowances: [],
      summary: {
        estimatedWalletUsd: 15,
      },
    },
  ]);

  const first = spawnSync(process.execPath, [join(ROOT, "src/cli/score-gateway.mjs"), "--write"], {
    cwd,
    env: {
      ...process.env,
      BOB_CLAW_DATA_DIR: dataDir,
    },
    encoding: "utf8",
  });
  assert.equal(first.status, 0, first.stderr || first.stdout);

  const second = spawnSync(
    process.execPath,
    [join(ROOT, "src/cli/score-gateway.mjs"), "--write", "--route-key=" + routeKey, "--amount=10000", "--shadow-rollover-ms=0"],
    {
      cwd,
      env: {
        ...process.env,
        BOB_CLAW_DATA_DIR: dataDir,
      },
      encoding: "utf8",
    },
  );
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.match(second.stdout, /shadowObservations=1/);

  const observations = (await readFile(join(dataDir, "gateway-shadow-observations.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(observations.length, 2);
  assert.equal(observations[0].routeKey, routeKey);
  assert.equal(observations[1].routeKey, routeKey);
});
