import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOracleSanitySnapshot, normalizeOraclePriceSample } from "../src/market/oracle-sanity.mjs";

test("oracle sanity snapshot uses the median reference price across providers", () => {
  const snapshot = buildOracleSanitySnapshot({
    assetKey: "btc",
    protocolPriceUsd: 65_010,
    referenceSamples: [
      { provider: "Chainlink", priceUsd: 65_000, observedAt: "2026-04-15T03:00:00.000Z" },
      { provider: "Pyth", priceUsd: 65_020, observedAt: "2026-04-15T03:00:01.000Z" },
      { provider: "dex_twap", priceUsd: 64_990, observedAt: "2026-04-15T03:00:02.000Z" },
    ],
    now: "2026-04-15T03:01:00.000Z",
    driftAlertPct: 4,
  });

  assert.equal(snapshot.status, "healthy");
  assert.equal(snapshot.referencePriceUsd, 65_000);
  assert.equal(snapshot.protocolDriftPct, 0.0154);
  assert.equal(snapshot.providers.includes("chainlink"), true);
  assert.equal(snapshot.providers.includes("pyth"), true);
});

test("oracle sanity snapshot marks protocol drift above trigger", () => {
  const snapshot = buildOracleSanitySnapshot({
    assetKey: "btc",
    protocolPriceUsd: 70_000,
    referenceSamples: [
      { provider: "chainlink", priceUsd: 65_000, observedAt: "2026-04-15T03:00:00.000Z" },
      { provider: "pyth", priceUsd: 65_100, observedAt: "2026-04-15T03:00:10.000Z" },
    ],
    now: "2026-04-15T03:01:00.000Z",
    driftAlertPct: 4,
  });

  assert.equal(snapshot.status, "drift_above_trigger");
  assert.equal(snapshot.protocolDriftPct > 7, true);
  assert.equal(snapshot.referenceSpreadPct < 1, true);
});

test("oracle sanity snapshot ignores stale samples beyond the freshness window", () => {
  const snapshot = buildOracleSanitySnapshot({
    assetKey: "btc",
    protocolPriceUsd: 65_000,
    referenceSamples: [
      { provider: "chainlink", priceUsd: 65_000, observedAt: "2026-04-15T00:00:00.000Z" },
    ],
    now: "2026-04-15T03:01:00.000Z",
    maxSampleAgeMs: 60_000,
  });

  assert.equal(snapshot.status, "missing_reference_price");
  assert.equal(snapshot.freshSampleCount, 0);
});

test("normalize oracle price sample lowercases provider names and carries age", () => {
  const sample = normalizeOraclePriceSample(
    {
      provider: "Chainlink",
      assetKey: "btc",
      priceUsd: 64_000,
      observedAt: "2026-04-15T03:00:00.000Z",
    },
    { now: "2026-04-15T03:00:10.000Z" },
  );

  assert.equal(sample.provider, "chainlink");
  assert.equal(sample.assetKey, "btc");
  assert.equal(sample.ageMs, 10_000);
});
