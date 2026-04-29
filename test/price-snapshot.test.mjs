import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runPriceSnapshot } from "../src/cli/price-snapshot.mjs";

test("price snapshot writes latest file even when jsonl append is skipped", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-price-snapshot-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const observedAt = "2026-04-28T22:10:00.000Z";
  const previousSnapshot = {
    observedAt,
    source: "coingecko_or_fallback",
    btcUsd: 100_000,
    tokenByKey: { btc: 100_000, wbtc: 100_000, ethereum: 2_500, usd_stable: 1 },
    nativeByChain: { ethereum: 2_500, base: 2_500, bob: 2_500 },
  };

  const result = await runPriceSnapshot({
    dataDir,
    now: new Date(observedAt),
    fetchPrices: async () => ({
      btc: 100_000,
      tokenByKey: { btc: 100_000, wbtc: 100_000, ethereum: 2_500, usd_stable: 1 },
      nativeByChain: { ethereum: 2_500, base: 2_500, bob: 2_500 },
    }),
    readJsonlImpl: async () => [previousSnapshot],
  });

  assert.equal(result.decision.shouldPersist, false);
  assert.equal(result.decision.reason, "recently_unchanged");
  assert.equal(result.appendPath, null);

  const latest = JSON.parse(await readFile(join(dataDir, "price-snapshot.json"), "utf8"));
  assert.equal(latest.observedAt, observedAt);
  assert.equal(latest.btcUsd, 100_000);
  assert.equal(latest.tokenByKey.ethereum, 2_500);
});
