import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);

async function withTempRoot(fn) {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-aggregate-auto-kill-"));
  try {
    await mkdir(join(dir, "data"), { recursive: true });
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("aggregate-auto-kill-inputs derives ETH/BTC from market snapshots and preserves recent history", async () => {
  await withTempRoot(async (rootDir) => {
    const scriptPath = join(process.cwd(), "src", "cli", "aggregate-auto-kill-inputs.mjs");
    const now = new Date();
    const snapshotAt = now.toISOString();
    const previousAt = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    await writeFile(
      join(rootDir, "data", "market-price-snapshots.jsonl"),
      `${JSON.stringify({
        observedAt: snapshotAt,
        source: "coingecko_or_fallback",
        btcUsd: 100_000,
        tokenByKey: { btc: 100_000, wbtc: 99_900, ethereum: 2_500 },
        nativeByChain: { ethereum: 2_500 },
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(rootDir, "data", "price-samples.json"),
      `${JSON.stringify({
        generatedAt: previousAt,
        samples: [
          {
            timestamp: previousAt,
            pair: "ETH/BTC",
            priceUsd: 0.020,
            source: "market_price_snapshot",
          },
        ],
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(rootDir, "data", "dashboard-status.json"),
      `${JSON.stringify({
        market: {
          btcUsd: 100_000,
          chainWbtcPrices: [{ chain: "ethereum", ticker: "wBTC", usd: 99_000 }],
        },
      })}\n`,
      "utf8",
    );

    await execFileAsync(process.execPath, [scriptPath], { cwd: rootDir });

    const payload = JSON.parse(await readFile(join(rootDir, "data", "price-samples.json"), "utf8"));
    const ethUsd = payload.samples.find((s) => s.pair === "ETH/USD");
    const ethBtc = payload.samples.filter((s) => s.pair === "ETH/BTC");
    assert.equal(ethUsd.priceUsd, 2_500);
    assert.equal(ethBtc.some((s) => s.priceUsd === 0.020), true);
    assert.equal(ethBtc.some((s) => s.priceUsd === 0.025), true);
    assert.equal(payload.samples.some((s) => s.pair === "ETH/USD" && s.priceUsd === 99_000), false);
  });
});

test("aggregate-auto-kill-inputs skips BTC-only snapshot when ETH market snapshot is available", async () => {
  await withTempRoot(async (rootDir) => {
    const scriptPath = join(process.cwd(), "src", "cli", "aggregate-auto-kill-inputs.mjs");
    const now = Date.now();
    const btcOnlyAt = new Date(now).toISOString();
    const marketAt = new Date(now - 30_000).toISOString();
    await writeFile(
      join(rootDir, "data", "price-snapshot.json"),
      `${JSON.stringify({
        observedAt: btcOnlyAt,
        source: "coingecko_or_fallback",
        btcUsd: 100_000,
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(rootDir, "data", "market-price-snapshots.jsonl"),
      `${JSON.stringify({
        observedAt: marketAt,
        source: "coingecko_or_fallback",
        btcUsd: 100_000,
        tokenByKey: { btc: 100_000, ethereum: 2_500 },
        nativeByChain: { ethereum: 2_500 },
      })}\n`,
      "utf8",
    );

    await execFileAsync(process.execPath, [scriptPath], { cwd: rootDir });

    const payload = JSON.parse(await readFile(join(rootDir, "data", "price-samples.json"), "utf8"));
    assert.equal(payload.freshness.selectedMarketSource, "market-price-snapshots");
    assert.equal(payload.samples.some((sample) => sample.pair === "ETH/USD" && sample.timestamp === marketAt), true);
    assert.equal(payload.samples.some((sample) => sample.pair === "ETH/BTC" && sample.priceUsd === 0.025), true);
  });
});

test("aggregate-auto-kill-inputs does not treat stale price snapshots as current market data", async () => {
  await withTempRoot(async (rootDir) => {
    const scriptPath = join(process.cwd(), "src", "cli", "aggregate-auto-kill-inputs.mjs");
    const staleAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await writeFile(
      join(rootDir, "data", "price-snapshot.json"),
      `${JSON.stringify({
        observedAt: staleAt,
        source: "coingecko_or_fallback",
        btcUsd: 100_000,
        tokenByKey: { btc: 100_000, ethereum: 2_500 },
        nativeByChain: { ethereum: 2_500 },
      })}\n`,
      "utf8",
    );

    await execFileAsync(process.execPath, [scriptPath], { cwd: rootDir });

    const payload = JSON.parse(await readFile(join(rootDir, "data", "price-samples.json"), "utf8"));
    assert.equal(payload.samples.some((sample) => sample.timestamp === staleAt), false);
    assert.equal(payload.samples.some((sample) => sample.pair === "ETH/USD" && sample.priceUsd === 2_500), false);
    assert.equal(payload.freshness.priceSnapshot.fresh, false);
    assert.equal(payload.freshness.selectedMarketSource, null);
  });
});

test("aggregate-auto-kill-inputs does not convert reward haircuts into campaign decay", async () => {
  await withTempRoot(async (rootDir) => {
    const scriptPath = join(process.cwd(), "src", "cli", "aggregate-auto-kill-inputs.mjs");
    await writeFile(
      join(rootDir, "data", "campaign-aware-opportunities.json"),
      `${JSON.stringify({
        candidates: [
          {
            opportunityId: "op-1",
            protocol: "yo",
            chain: "base",
            displayedApr: 20,
            expectedRealizedAprAfterHaircut: 10,
            tvlUsd: 100_000,
            entryStatus: "auto_allowed",
          },
        ],
      })}\n`,
      "utf8",
    );

    await execFileAsync(process.execPath, [scriptPath], { cwd: rootDir });

    const campaignStatus = JSON.parse(await readFile(join(rootDir, "data", "campaign-status.json"), "utf8"));
    assert.equal(campaignStatus.entryAprPct, 10);
    assert.equal(campaignStatus.currentAprPct, 10);
  });
});
