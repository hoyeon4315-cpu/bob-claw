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
  assert.equal(result.edgePct, 0);
  assert.equal(result.gatewayImpliedPriceUsd, 70000);
  assert.equal(result.lagUsd, 0);
  assert.equal(result.edgeUsd, 0);
});

test("computeLag btc_wrap: 0.5% haircut gives negative lag", () => {
  const probe = {
    routeKey: "bitcoin:0x0000000000000000000000000000000000000000->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    family: "btc_wrap",
    amount: "200000",
    execCostUsd: 2.37,
  };
  const payload = { inputAmount: "200000", outputAmount: "199000" };
  const result = computeLag(probe, payload, "onramp", 70000);

  assert.equal(result.lagPct, -0.5);
  assert.equal(result.edgePct, -0.5); // btc_wrap: edgePct = lagPct
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
  assert.equal(result.edgePct, 0.2);
  assert.equal(result.gatewayImpliedPriceUsd, 70140);
});

// ── computeLag for stablecoin→BTC (btc_swap offramp, buying side) ────────────

test("computeLag btc_swap USDC→BTC: fair price gives 0% lag", () => {
  const probe = {
    routeKey: "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000",
    family: "btc_swap",
    amount: "250000000",
    execCostUsd: 0.10,
  };
  const payload = { inputAmount: "250000000", outputAmount: "357143" };
  const result = computeLag(probe, payload, "offramp", 70000);

  assert.ok(Math.abs(result.lagPct) < 0.001, `lagPct should be ~0%, got ${result.lagPct}%`);
  assert.ok(Math.abs(result.edgePct) < 0.001, `edgePct should be ~0%, got ${result.edgePct}%`);
});

test("computeLag btc_swap USDC→BTC: fewer sats means gateway prices BTC higher (bad for buyer)", () => {
  const probe = {
    routeKey: "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000",
    family: "btc_swap",
    amount: "250000000",
    execCostUsd: 0.10,
  };
  // Send $250, receive fewer sats than fair => gateway prices BTC higher
  const payload = { inputAmount: "250000000", outputAmount: "350000" };
  const result = computeLag(probe, payload, "offramp", 70000);

  assert.ok(result.lagPct > 2, `lagPct should be positive (gateway prices BTC higher), got ${result.lagPct}%`);
  assert.ok(result.edgePct < -2, `edgePct should be NEGATIVE (buying at premium is bad), got ${result.edgePct}%`);
  assert.ok(result.gatewayImpliedPriceUsd > 70000);
});

// ── computeLag for BTC→stablecoin (btc_swap onramp, selling side) ────────────

test("computeLag btc_swap BTC→USDC: gateway overpricing BTC is good for seller", () => {
  const probe = {
    routeKey: "bitcoin:0x0000000000000000000000000000000000000000->base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    family: "btc_swap",
    amount: "350000",
    execCostUsd: 1.50,
  };
  // Send 350000 sats, receive $250 USDC (implies BTC = $71428.57, market $70000)
  const payload = { inputAmount: "350000", outputAmount: "250000000" };
  const result = computeLag(probe, payload, "onramp", 70000);

  assert.ok(result.lagPct > 0, `lagPct should be positive, got ${result.lagPct}%`);
  assert.ok(result.edgePct > 0, `edgePct should be POSITIVE (selling at premium is good), got ${result.edgePct}%`);
  assert.equal(result.edgePct, result.lagPct); // sell side: edge = lag
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
  assert.equal(result.edgePct, null);
  assert.equal(result.lagUsd, null);
  assert.equal(result.edgeUsd, null);
});

// ── buildLagSummary ──────────────────────────────────────────────────────────

test("buildLagSummary returns no_data for empty array", () => {
  const summary = buildLagSummary([]);
  assert.equal(summary.sampleCount, 0);
  assert.equal(summary.verdict, "no_data");
  assert.equal(summary.lagStats.maxEdgePct, null);
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
          edgePct: 0.172,
          edgeUsd: 0.25,
          profitable: false,
        },
        {
          label: "Base USDC→BTC (buy)",
          success: true,
          edgePct: -0.378,
          edgeUsd: -0.95,
          profitable: false,
        },
      ],
    },
  ];
  const summary = buildLagSummary(samples);

  assert.equal(summary.sampleCount, 1);
  assert.equal(summary.btcPriceRange.min, 71706);
  assert.equal(summary.btcPriceRange.max, 71706);
  assert.equal(summary.lagStats.maxEdgePct, 0.172);
  assert.equal(summary.lagStats.profitableSampleCount, 0);
  assert.equal(summary.verdict, "no_profitable_dislocations");
  assert.equal(summary.probeStats.length, 2);

  const wbtcStat = summary.probeStats.find((s) => s.label === "BTC→BOB wBTC.OFT");
  assert.equal(wbtcStat.sampleCount, 1);
  assert.equal(wbtcStat.successRate, 1);
  assert.equal(wbtcStat.maxEdgePct, 0.172);
});

test("buildLagSummary detects profitable dislocations", () => {
  const samples = [
    {
      observedAt: "2026-04-12T07:05:00Z",
      btcMarketUsd: 71706,
      probes: [
        { label: "BTC→BOB wBTC.OFT", success: true, edgePct: 5.0, edgeUsd: 7.17, profitable: true },
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
        { label: "BTC→BOB wBTC.OFT", success: false, edgePct: null, edgeUsd: null, profitable: false },
        { label: "Base USDC→BTC (buy)", success: true, edgePct: -0.378, edgeUsd: -0.95, profitable: false },
      ],
    },
  ];
  const summary = buildLagSummary(samples);

  assert.equal(summary.lagStats.maxEdgePct, -0.378);
  const wbtcStat = summary.probeStats.find((s) => s.label === "BTC→BOB wBTC.OFT");
  assert.equal(wbtcStat.successRate, 0);
  assert.equal(wbtcStat.avgEdgePct, null);
});

// ── Profitable detection logic ───────────────────────────────────────────────

test("profitable is true only when edgeUsd exceeds execCostUsd", () => {
  const probe = {
    routeKey: "bitcoin:0x0000000000000000000000000000000000000000->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    family: "btc_wrap",
    amount: "100000000",
    execCostUsd: 2.37,
  };
  // 1 BTC in, 1.001 BTC out at market $70000 → edgeUsd ≈ $70
  const payload = { inputAmount: "100000000", outputAmount: "100100000" };
  const lag = computeLag(probe, payload, "onramp", 70000);

  assert.ok(lag.edgePct > 0, "edgePct should be positive");
  assert.ok(lag.edgeUsd > 2.37, `edgeUsd (${lag.edgeUsd}) should exceed exec cost ($2.37)`);

  const netAfterExec = lag.edgeUsd - probe.execCostUsd;
  assert.ok(netAfterExec > 0, "net after exec should be positive");
});

test("profitable is false when edgeUsd is below execCostUsd", () => {
  const probe = {
    routeKey: "bitcoin:0x0000000000000000000000000000000000000000->bob:0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    family: "btc_wrap",
    amount: "200000",
    execCostUsd: 2.37,
  };
  const payload = { inputAmount: "200000", outputAmount: "200010" };
  const lag = computeLag(probe, payload, "onramp", 70000);

  assert.ok(lag.edgePct > 0, "edgePct should be positive");
  assert.ok(lag.edgeUsd < 2.37, `edgeUsd (${lag.edgeUsd}) should be below exec cost ($2.37)`);
});

test("stablecoin→BTC: positive lag yields negative edge (not profitable)", () => {
  const probe = {
    routeKey: "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913->bitcoin:0x0000000000000000000000000000000000000000",
    family: "btc_swap",
    amount: "250000000",
    execCostUsd: 0.10,
  };
  // Gateway gives 347638 sats for $250 — implies BTC=$71914, market=$71643
  const payload = { inputAmount: "250000000", outputAmount: "347638" };
  const result = computeLag(probe, payload, "offramp", 71643);

  assert.ok(result.lagPct > 0, "lagPct positive — Gateway overprices BTC");
  assert.ok(result.edgePct < 0, "edgePct negative — buying at premium is bad");
  // netAfterExec should be negative
  const net = result.edgeUsd - probe.execCostUsd;
  assert.ok(net < 0, `net (${net}) should be negative for buy-at-premium`);
});
