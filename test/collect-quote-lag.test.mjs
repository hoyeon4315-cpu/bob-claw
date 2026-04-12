import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLag, parseRouteKey, buildLagSummary } from "../src/cli/collect-quote-lag.mjs";

// ── parseRouteKey ────────────────────────────────────────────────────────────

test("parseRouteKey splits chain:token->chain:token", () => {
  const result = parseRouteKey(
    "bitcoin:0x0000000000000000000000000000000000000000->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
  );
  assert.deepEqual(result, {
    srcChain: "bitcoin",
    srcToken: "0x0000000000000000000000000000000000000000",
    dstChain: "bob",
    dstToken: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
  });
});

test("parseRouteKey returns null for invalid input", () => {
  assert.equal(parseRouteKey("garbage"), null);
  assert.equal(parseRouteKey("no-arrow"), null);
});

// ── computeLag for BTC→wBTC.OFT (btc_wrap onramp) ───────────────────────────

test("computeLag btc_wrap: zero fee gives 0% lag", () => {
  const probe = {
    routeKey: "bitcoin:0x0000000000000000000000000000000000000000->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    family: "btc_wrap",
    amount: "200000",
    execCostUsd: 2.37,
  };
  const payload = { inputAmount: "200000", outputAmount: "200000" };
  const result = computeLag(probe, payload, "onramp", 70000);

  assert.equal(result.lagPct, 0);
  assert.equal(result.gatewayImpliedPriceUsd, 70000);
  assert.equal(result.lagUsd, 0);
});

test("computeLag btc_wrap: 0.5% haircut gives negative lag", () => {
  const probe = {
    routeKey: "bitcoin:0x0000000000000000000000000000000000000000->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    family: "btc_wrap",
    amount: "200000",
    execCostUsd: 2.37,
  };
  // 200000 sats in, 199000 sats out => 0.5% less
  const payload = { inputAmount: "200000", outputAmount: "199000" };
  const result = computeLag(probe, payload, "onramp", 70000);

  assert.equal(result.lagPct, -0.5);
  assert.equal(result.gatewayImpliedPriceUsd, 69650);
});

test("computeLag btc_wrap: output > input gives positive lag", () => {
  const probe = {
    routeKey: "bitcoin:0x0000000000000000000000000000000000000000->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    family: "btc_wrap",
    amount: "200000",
    execCostUsd: 2.37,
  };
  const payload = { inputAmount: "200000", outputAmount: "200400" };
  const result = computeLag(probe, payload, "onramp", 70000);

  assert.equal(result.lagPct, 0.2);
  assert.equal(result.gatewayImpliedPriceUsd, 70140);
});

// ── computeLag for stablecoin→BTC (btc_swap offramp) ─────────────────────────

test("computeLag btc_swap USDC→BTC: fair price gives 0% lag", () => {
  const probe = {
    routeKey: "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000",
    family: "btc_swap",
    amount: "250000000",
    execCostUsd: 0.10,
  };
  // Send $250 USDC (250_000_000 in 6-dec), receive sats worth $250 at market
  // At BTC=$70000, $250 = 0.00357143 BTC = 357143 sats
  // gatewayBtcPrice = (250_000_000/1e6) / (357143/1e8) = 250 / 0.00357143 ≈ 70000
  const payload = { inputAmount: "250000000", outputAmount: "357143" };
  const result = computeLag(probe, payload, "offramp", 70000);

  // 250/0.00357143 ≈ 69999.86 — close to 70000
  assert.ok(Math.abs(result.lagPct) < 0.001, `lagPct should be ~0%, got ${result.lagPct}%`);
});

test("computeLag btc_swap USDC→BTC: fewer sats means gateway prices BTC higher", () => {
  const probe = {
    routeKey: "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000",
    family: "btc_swap",
    amount: "250000000",
    execCostUsd: 0.10,
  };
  // Send $250, receive fewer sats than fair => gateway prices BTC higher
  // At BTC=$70000 fair = 357143 sats. If we only get 350000 sats:
  // gatewayBtcPrice = 250 / 0.0035 = 71428.57
  const payload = { inputAmount: "250000000", outputAmount: "350000" };
  const result = computeLag(probe, payload, "offramp", 70000);

  assert.ok(result.lagPct > 2, `lagPct should be positive (gateway prices BTC higher), got ${result.lagPct}%`);
  assert.ok(result.gatewayImpliedPriceUsd > 70000);
});

// ── computeLag edge cases ────────────────────────────────────────────────────

test("computeLag returns nulls for zero output", () => {
  const probe = {
    routeKey: "bitcoin:0x0000000000000000000000000000000000000000->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    family: "btc_wrap",
    amount: "200000",
    execCostUsd: 2.37,
  };
  const result = computeLag(probe, { inputAmount: "200000", outputAmount: "0" }, "onramp", 70000);

  assert.equal(result.gatewayImpliedPriceUsd, null);
  assert.equal(result.lagPct, null);
  assert.equal(result.lagUsd, null);
});

// ── buildLagSummary ──────────────────────────────────────────────────────────

test("buildLagSummary returns no_data for empty array", () => {
  const summary = buildLagSummary([]);
  assert.equal(summary.sampleCount, 0);
  assert.equal(summary.verdict, "no_data");
  assert.equal(summary.lagStats.maxLagPct, null);
});

test("buildLagSummary computes stats from one sample", () => {
  const samples = [
    {
      observedAt: "2026-04-12T07:05:00Z",
      btcMarketUsd: 71706,
      probes: [
        {
          label: "BTC→BOB wBTC.OFT",
          success: true,
          lagPct: 0.172,
          lagUsd: 0.25,
          profitable: false,
        },
        {
          label: "Base USDC→BTC",
          success: true,
          lagPct: -0.05,
          lagUsd: -0.04,
          profitable: false,
        },
      ],
    },
  ];
  const summary = buildLagSummary(samples);

  assert.equal(summary.sampleCount, 1);
  assert.equal(summary.btcPriceRange.min, 71706);
  assert.equal(summary.btcPriceRange.max, 71706);
  assert.equal(summary.lagStats.maxLagPct, 0.172);
  assert.equal(summary.lagStats.profitableSampleCount, 0);
  assert.equal(summary.verdict, "no_profitable_dislocations");
  assert.equal(summary.probeStats.length, 2);

  const wbtcStat = summary.probeStats.find((s) => s.label === "BTC→BOB wBTC.OFT");
  assert.equal(wbtcStat.sampleCount, 1);
  assert.equal(wbtcStat.successRate, 1);
  assert.equal(wbtcStat.maxLagPct, 0.172);
});

test("buildLagSummary detects profitable dislocations", () => {
  const samples = [
    {
      observedAt: "2026-04-12T07:05:00Z",
      btcMarketUsd: 71706,
      probes: [
        { label: "BTC→BOB wBTC.OFT", success: true, lagPct: 5.0, lagUsd: 7.17, profitable: true },
      ],
    },
  ];
  const summary = buildLagSummary(samples);

  assert.equal(summary.lagStats.profitableSampleCount, 1);
  assert.equal(summary.verdict, "profitable_dislocations_found");
});

test("buildLagSummary handles failed probes gracefully", () => {
  const samples = [
    {
      observedAt: "2026-04-12T07:05:00Z",
      btcMarketUsd: 71706,
      probes: [
        { label: "BTC→BOB wBTC.OFT", success: false, lagPct: null, lagUsd: null, profitable: false },
        { label: "Base USDC→BTC", success: true, lagPct: 0.1, lagUsd: 0.07, profitable: false },
      ],
    },
  ];
  const summary = buildLagSummary(samples);

  assert.equal(summary.lagStats.maxLagPct, 0.1);
  const wbtcStat = summary.probeStats.find((s) => s.label === "BTC→BOB wBTC.OFT");
  assert.equal(wbtcStat.successRate, 0);
  assert.equal(wbtcStat.avgLagPct, null);
});

// ── Profitable detection logic ───────────────────────────────────────────────

test("profitable is true only when lagUsd exceeds execCostUsd", () => {
  // Simulate: lagUsd = $5, execCost = $2.37 → net $2.63 → profitable
  const probe = {
    routeKey: "bitcoin:0x0000000000000000000000000000000000000000->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    family: "btc_wrap",
    amount: "100000000",
    execCostUsd: 2.37,
  };
  // 1 BTC in, 1.001 BTC out at market $70000 → lagUsd ≈ $70
  const payload = { inputAmount: "100000000", outputAmount: "100100000" };
  const lag = computeLag(probe, payload, "onramp", 70000);

  assert.ok(lag.lagPct > 0, "lagPct should be positive");
  assert.ok(lag.lagUsd > 2.37, `lagUsd (${lag.lagUsd}) should exceed exec cost ($2.37)`);

  const netAfterExec = lag.lagUsd - probe.execCostUsd;
  assert.ok(netAfterExec > 0, "net after exec should be positive");
});

test("profitable is false when lagUsd is below execCostUsd", () => {
  const probe = {
    routeKey: "bitcoin:0x0000000000000000000000000000000000000000->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    family: "btc_wrap",
    amount: "200000",
    execCostUsd: 2.37,
  };
  // Tiny positive lag: 200000 → 200010 sats (0.005%)
  const payload = { inputAmount: "200000", outputAmount: "200010" };
  const lag = computeLag(probe, payload, "onramp", 70000);

  assert.ok(lag.lagPct > 0, "lagPct should be positive");
  assert.ok(lag.lagUsd < 2.37, `lagUsd (${lag.lagUsd}) should be below exec cost ($2.37)`);
});
