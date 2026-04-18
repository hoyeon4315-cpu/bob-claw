import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WBTC_OFT = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_ETHEREUM = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

async function writeJsonl(baseDir, name, records) {
  await mkdir(baseDir, { recursive: true });
  const path = join(baseDir, `${name}.jsonl`);
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path, body ? `${body}\n` : "", "utf8");
}

function quote({ observedAt, route, amount = "10000", inputAmount = "10000", outputAmount = "10000" }) {
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

test("score gateway selectively refreshes one route and preserves unrelated scores", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-score-gateway-"));
  const dataDir = join(cwd, "data");
  const now = Date.now();
  const iso = (offsetMs) => new Date(now + offsetMs).toISOString();
  const targetRoute = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const untouchedRoute = { srcChain: "base", dstChain: "ethereum", srcToken: USDC_BASE, dstToken: USDC_ETHEREUM };
  const targetRouteKey = `${targetRoute.srcChain}:${targetRoute.srcToken}->${targetRoute.dstChain}:${targetRoute.dstToken}`;
  const untouchedRouteKey = `${untouchedRoute.srcChain}:${untouchedRoute.srcToken}->${untouchedRoute.dstChain}:${untouchedRoute.dstToken}`;

  await writeJsonl(dataDir, "gateway-quotes", [
    quote({
      observedAt: iso(-180_000),
      route: targetRoute,
      outputAmount: "10000",
    }),
    quote({
      observedAt: iso(-60_000),
      route: targetRoute,
      outputAmount: "12100",
    }),
    quote({
      observedAt: iso(-240_000),
      route: untouchedRoute,
      inputAmount: "1000000",
      outputAmount: "1000000",
    }),
  ]);
  await writeJsonl(dataDir, "gateway-quote-failures", []);
  await writeJsonl(dataDir, "dex-quotes", []);
  await writeJsonl(dataDir, "bitcoin-fee-snapshots", [
    {
      observedAt: iso(-120_000),
      btcUsd: 50000,
    },
  ]);
  await writeJsonl(dataDir, "gateway-gas-estimates", [
    {
      observedAt: iso(-90_000),
      routeKey: targetRouteKey,
      amount: "10000",
      estimatedGasUsd: 0.001,
    },
    {
      observedAt: iso(-210_000),
      routeKey: untouchedRouteKey,
      amount: "10000",
      estimatedGasUsd: 0.01,
    },
  ]);
  await writeJsonl(dataDir, "gas-snapshots", [
    {
      observedAt: iso(-120_000),
      chain: "bob",
      nativeUsd: 3000,
      gasPriceWei: "1000000000",
      fallbackGasUnits: 21000,
    },
    {
      observedAt: iso(-240_000),
      chain: "base",
      nativeUsd: 3000,
      gasPriceWei: "1000000000",
      fallbackGasUnits: 21000,
    },
    {
      observedAt: iso(-240_000),
      chain: "ethereum",
      nativeUsd: 3000,
      gasPriceWei: "1000000000",
      fallbackGasUnits: 21000,
    },
  ]);
  await writeFile(
    join(dataDir, "gateway-scores.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: iso(-150_000),
      priceObservedAt: iso(-150_000),
      btcUsd: 50000,
      scoredQuotes: 2,
      summary: {
        shadowCandidates: 0,
        dexBacked: 0,
        insufficientData: 0,
        highFailureRate: 0,
        staleGas: 0,
        missingDecimals: 0,
      },
      scores: [
        {
          routeKey: targetRouteKey,
          amount: "10000",
          netEdgeUsd: -0.5,
          tradeReadiness: "reject_no_net_edge",
          dataGaps: [],
          routeStats: { failureRate: 0 },
          dex: null,
          observedAt: iso(-180_000),
        },
        {
          routeKey: untouchedRouteKey,
          amount: "10000",
          netEdgeUsd: 0.2,
          tradeReadiness: "shadow_candidate_review_only",
          dataGaps: [],
          routeStats: { failureRate: 0 },
          dex: null,
          observedAt: iso(-240_000),
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  const result = spawnSync(
    process.execPath,
    [join(ROOT, "src/cli/score-gateway.mjs"), "--write", `--route-key=${targetRouteKey}`, "--amount=10000"],
    {
      cwd,
      env: {
        ...process.env,
        BOB_CLAW_DATA_DIR: dataDir,
      },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /selection routeKey=/);

  const snapshot = JSON.parse(await readFile(join(dataDir, "gateway-scores.json"), "utf8"));
  assert.equal(snapshot.scoredQuotes, 2);
  assert.equal(snapshot.summary.shadowCandidates, 2);
  const target = snapshot.scores.find((item) => item.routeKey === targetRouteKey);
  const untouched = snapshot.scores.find((item) => item.routeKey === untouchedRouteKey);
  assert.equal(target.observedAt, iso(-60_000));
  assert.equal(target.tradeReadiness, "shadow_candidate_review_only");
  assert.equal(target.netEdgeUsd > 0, true);
  assert.equal(untouched.netEdgeUsd, 0.2);
  assert.equal(untouched.tradeReadiness, "shadow_candidate_review_only");
  assert.equal(untouched.observedAt, iso(-240_000));
});

test("score gateway prefers a fresh gas snapshot over stale exact gas", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-score-gateway-fallback-gas-"));
  const dataDir = join(cwd, "data");
  const now = Date.now();
  const iso = (offsetMs) => new Date(now + offsetMs).toISOString();
  const route = { srcChain: "base", dstChain: "bob", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const routeKey = `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`;

  await writeJsonl(dataDir, "gateway-quotes", [
    quote({
      observedAt: iso(-60_000),
      route,
      outputAmount: "12000",
    }),
  ]);
  await writeJsonl(dataDir, "gateway-quote-failures", []);
  await writeJsonl(dataDir, "dex-quotes", []);
  await writeJsonl(dataDir, "bitcoin-fee-snapshots", [
    {
      observedAt: iso(-120_000),
      btcUsd: 50000,
    },
  ]);
  await writeJsonl(dataDir, "gateway-gas-estimates", [
    {
      observedAt: iso(-(45 * 60_000)),
      routeKey,
      amount: "10000",
      estimatedGasUsd: 0.5,
    },
  ]);
  await writeJsonl(dataDir, "gas-snapshots", [
    {
      observedAt: iso(-120_000),
      chain: "bob",
      nativeUsd: 3000,
      gasPriceWei: "1000000000",
      fallbackGasUnits: 21000,
    },
    {
      observedAt: iso(-120_000),
      chain: "base",
      nativeUsd: 3000,
      gasPriceWei: "1000000000",
      fallbackGasUnits: 21000,
    },
    {
      observedAt: iso(-120_000),
      chain: "ethereum",
      nativeUsd: 3000,
      gasPriceWei: "1000000000",
      fallbackGasUnits: 21000,
    },
    {
      observedAt: iso(-120_000),
      chain: "bitcoin",
      nativeUsd: 50000,
      gasPriceWei: "1",
      fallbackGasUnits: 1,
    },
    {
      observedAt: iso(-120_000),
      chain: "avalanche",
      nativeUsd: 30,
      gasPriceWei: "1000000000",
      fallbackGasUnits: 21000,
    },
    {
      observedAt: iso(-2 * 60_000),
      chain: "base",
      nativeUsd: 3000,
      gasPriceWei: "1000000000",
      fallbackGasUnits: 21000,
    },
  ]);
  await writeFile(
    join(dataDir, "gateway-scores.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: iso(-150_000),
      priceObservedAt: iso(-150_000),
      btcUsd: 50000,
      scoredQuotes: 1,
      summary: {
        shadowCandidates: 0,
        dexBacked: 0,
        insufficientData: 0,
        highFailureRate: 0,
        staleGas: 0,
        missingDecimals: 0,
      },
      scores: [
        {
          routeKey,
          amount: "10000",
          netEdgeUsd: -0.5,
          tradeReadiness: "reject_no_net_edge",
          dataGaps: [],
          routeStats: { failureRate: 0 },
          dex: null,
          observedAt: iso(-180_000),
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  const result = spawnSync(
    process.execPath,
    [join(ROOT, "src/cli/score-gateway.mjs"), "--write", `--route-key=${routeKey}`, "--amount=10000"],
    {
      cwd,
      env: {
        ...process.env,
        BOB_CLAW_DATA_DIR: dataDir,
      },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const snapshot = JSON.parse(await readFile(join(dataDir, "gateway-scores.json"), "utf8"));
  const refreshed = snapshot.scores.find((item) => item.routeKey === routeKey && item.amount === "10000");
  assert.equal(refreshed.executionGasSource, "fallback_gas_units");
  assert.ok(refreshed.executionGasUsd > 0, `${refreshed.executionGasUsd}`);
  assert.ok(refreshed.executionGasUsd < 0.5, `${refreshed.executionGasUsd}`);
  assert.equal(refreshed.dataGaps.includes("stale_src_gas_snapshot"), false);
  assert.equal(refreshed.dataGaps.includes("exact_src_execution_gas_not_estimated"), true);
  assert.ok(refreshed.gasSnapshotAgeMinutes < 5, `${refreshed.gasSnapshotAgeMinutes}`);
});

test("score gateway matches trusted destination-leg dex quotes by route and amount", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-score-gateway-dex-amount-"));
  const dataDir = join(cwd, "data");
  const now = Date.now();
  const iso = (offsetMs) => new Date(now + offsetMs).toISOString();
  const route = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const routeKey = `${route.srcChain}:${route.srcToken}->${route.dstChain}:${route.dstToken}`;

  await writeJsonl(dataDir, "gateway-quotes", [
    quote({ observedAt: iso(-60_000), route, amount: "10000", inputAmount: "10000", outputAmount: "9000" }),
    quote({ observedAt: iso(-50_000), route, amount: "25000", inputAmount: "25000", outputAmount: "22500" }),
  ]);
  await writeJsonl(dataDir, "gateway-quote-failures", []);
  await writeJsonl(dataDir, "dex-quotes", [
    {
      observedAt: iso(-55_000),
      provider: "mockdex",
      quoteType: "token_to_stable",
      source: "gateway_dst_leg",
      chain: "base",
      gatewayRouteKey: routeKey,
      gatewayAmount: "10000",
      outputTicker: "USDC",
      outputAmount: "6200000",
      outputValueUsd: 6.2,
      netOutputValueUsd: 6.18,
      gasEstimateValueUsd: 0.02,
    },
    {
      observedAt: iso(-40_000),
      provider: "mockdex",
      quoteType: "token_to_stable",
      source: "gateway_dst_leg",
      chain: "base",
      gatewayRouteKey: routeKey,
      gatewayAmount: "25000",
      outputTicker: "USDC",
      outputAmount: "99000000",
      outputValueUsd: 99,
      netOutputValueUsd: 98.98,
      gasEstimateValueUsd: 0.02,
    },
  ]);
  await writeJsonl(dataDir, "bitcoin-fee-snapshots", [
    {
      observedAt: iso(-120_000),
      btcUsd: 50000,
    },
  ]);
  await writeJsonl(dataDir, "gateway-gas-estimates", [
    { observedAt: iso(-90_000), routeKey, amount: "10000", estimatedGasUsd: 0.001 },
    { observedAt: iso(-90_000), routeKey, amount: "25000", estimatedGasUsd: 0.001 },
  ]);
  await writeJsonl(dataDir, "gas-snapshots", [
    { observedAt: iso(-120_000), chain: "bob", nativeUsd: 3000, gasPriceWei: "1000000000", fallbackGasUnits: 21000 },
    { observedAt: iso(-120_000), chain: "base", nativeUsd: 3000, gasPriceWei: "1000000000", fallbackGasUnits: 21000 },
  ]);
  await writeFile(
    join(dataDir, "gateway-scores.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: iso(-150_000),
      priceObservedAt: iso(-150_000),
      btcUsd: 50000,
      scoredQuotes: 2,
      summary: { shadowCandidates: 0, dexBacked: 0, insufficientData: 0, highFailureRate: 0, staleGas: 0, missingDecimals: 0 },
      scores: [
        { routeKey, amount: "10000", netEdgeUsd: -0.5, tradeReadiness: "reject_no_net_edge", dataGaps: [], routeStats: { failureRate: 0 }, dex: null, observedAt: iso(-180_000) },
        { routeKey, amount: "25000", netEdgeUsd: -0.4, tradeReadiness: "reject_no_net_edge", dataGaps: [], routeStats: { failureRate: 0 }, dex: null, observedAt: iso(-170_000) },
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  const result = spawnSync(
    process.execPath,
    [join(ROOT, "src/cli/score-gateway.mjs"), "--write", `--route-key=${routeKey}`, "--amount=10000"],
    {
      cwd,
      env: { ...process.env, BOB_CLAW_DATA_DIR: dataDir },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const snapshot = JSON.parse(await readFile(join(dataDir, "gateway-scores.json"), "utf8"));
  const refreshed = snapshot.scores.find((item) => item.routeKey === routeKey && item.amount === "10000");
  const untouched = snapshot.scores.find((item) => item.routeKey === routeKey && item.amount === "25000");

  assert.equal(refreshed.dex.outputAmount, "6200000");
  assert.equal(refreshed.dex.outputValueUsd, 6.2);
  assert.equal(refreshed.dex.netOutputValueUsd, 6.18);
  assert.equal(refreshed.executableOutputUsd, 6.18);
  assert.equal(untouched.observedAt, iso(-170_000));
});

test("score gateway selectively refreshes destination-chain routes and preserves unrelated scores", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-score-gateway-chains-"));
  const dataDir = join(cwd, "data");
  const now = Date.now();
  const iso = (offsetMs) => new Date(now + offsetMs).toISOString();
  const baseRoute = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const ethereumRoute = { srcChain: "bob", dstChain: "ethereum", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const baseStableRoute = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: USDC_BASE };
  const untouchedRoute = { srcChain: "base", dstChain: "bitcoin", srcToken: USDC_BASE, dstToken: "0x0000000000000000000000000000000000000000" };
  const baseRouteKey = `${baseRoute.srcChain}:${baseRoute.srcToken}->${baseRoute.dstChain}:${baseRoute.dstToken}`;
  const ethereumRouteKey = `${ethereumRoute.srcChain}:${ethereumRoute.srcToken}->${ethereumRoute.dstChain}:${ethereumRoute.dstToken}`;
  const baseStableRouteKey = `${baseStableRoute.srcChain}:${baseStableRoute.srcToken}->${baseStableRoute.dstChain}:${baseStableRoute.dstToken}`;
  const untouchedRouteKey = `${untouchedRoute.srcChain}:${untouchedRoute.srcToken}->${untouchedRoute.dstChain}:${untouchedRoute.dstToken}`;

  await writeJsonl(dataDir, "gateway-quotes", [
    quote({ observedAt: iso(-60_000), route: baseRoute, outputAmount: "12000" }),
    quote({ observedAt: iso(-50_000), route: ethereumRoute, outputAmount: "12100" }),
    quote({ observedAt: iso(-45_000), route: baseStableRoute, outputAmount: "1000000" }),
    quote({ observedAt: iso(-40_000), route: untouchedRoute, inputAmount: "1000000", outputAmount: "5000" }),
  ]);
  await writeJsonl(dataDir, "gateway-quote-failures", []);
  await writeJsonl(dataDir, "dex-quotes", []);
  await writeJsonl(dataDir, "bitcoin-fee-snapshots", [{ observedAt: iso(-120_000), btcUsd: 50000 }]);
  await writeJsonl(dataDir, "gateway-gas-estimates", [
    { observedAt: iso(-90_000), routeKey: baseRouteKey, amount: "10000", estimatedGasUsd: 0.001 },
    { observedAt: iso(-90_000), routeKey: ethereumRouteKey, amount: "10000", estimatedGasUsd: 0.001 },
    { observedAt: iso(-90_000), routeKey: baseStableRouteKey, amount: "10000", estimatedGasUsd: 0.001 },
    { observedAt: iso(-90_000), routeKey: untouchedRouteKey, amount: "10000", estimatedGasUsd: 0.02 },
  ]);
  await writeJsonl(dataDir, "gas-snapshots", [
    { observedAt: iso(-120_000), chain: "bob", nativeUsd: 3000, gasPriceWei: "1000000000", fallbackGasUnits: 21000 },
    { observedAt: iso(-120_000), chain: "base", nativeUsd: 3000, gasPriceWei: "1000000000", fallbackGasUnits: 21000 },
    { observedAt: iso(-120_000), chain: "ethereum", nativeUsd: 3000, gasPriceWei: "1000000000", fallbackGasUnits: 21000 },
  ]);
  await writeFile(
    join(dataDir, "gateway-scores.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: iso(-150_000),
      priceObservedAt: iso(-150_000),
      btcUsd: 50000,
      scoredQuotes: 4,
      summary: { shadowCandidates: 0, dexBacked: 0, insufficientData: 0, highFailureRate: 0, staleGas: 0, missingDecimals: 0 },
      scores: [
        { routeKey: baseRouteKey, amount: "10000", netEdgeUsd: -0.5, tradeReadiness: "reject_no_net_edge", dataGaps: [], routeStats: { failureRate: 0 }, dex: null, observedAt: iso(-180_000) },
        { routeKey: ethereumRouteKey, amount: "10000", netEdgeUsd: -0.4, tradeReadiness: "reject_no_net_edge", dataGaps: [], routeStats: { failureRate: 0 }, dex: null, observedAt: iso(-180_000) },
        { routeKey: baseStableRouteKey, amount: "10000", netEdgeUsd: -0.3, tradeReadiness: "reject_no_net_edge", dataGaps: [], routeStats: { failureRate: 0 }, dex: null, observedAt: iso(-180_000) },
        { routeKey: untouchedRouteKey, amount: "10000", netEdgeUsd: 0.2, tradeReadiness: "shadow_candidate_review_only", dataGaps: [], routeStats: { failureRate: 0 }, dex: null, observedAt: iso(-240_000) },
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  const result = spawnSync(
    process.execPath,
    [join(ROOT, "src/cli/score-gateway.mjs"), "--write", "--dst-chains=base,ethereum"],
    {
      cwd,
      env: { ...process.env, BOB_CLAW_DATA_DIR: dataDir },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /selection dstChains=base,ethereum refreshed=2/);

  const snapshot = JSON.parse(await readFile(join(dataDir, "gateway-scores.json"), "utf8"));
  assert.equal(snapshot.scoredQuotes, 4);
  const refreshedBase = snapshot.scores.find((item) => item.routeKey === baseRouteKey);
  const refreshedEthereum = snapshot.scores.find((item) => item.routeKey === ethereumRouteKey);
  const untouchedBaseStable = snapshot.scores.find((item) => item.routeKey === baseStableRouteKey);
  const untouched = snapshot.scores.find((item) => item.routeKey === untouchedRouteKey);
  assert.equal(refreshedBase.observedAt, iso(-60_000));
  assert.equal(refreshedEthereum.observedAt, iso(-50_000));
  assert.equal(untouchedBaseStable.observedAt, iso(-180_000));
  assert.equal(untouchedBaseStable.netEdgeUsd, -0.3);
  assert.equal(untouched.observedAt, iso(-240_000));
  assert.equal(untouched.netEdgeUsd, 0.2);
});

test("score gateway selectively refreshes touched BTC-family routes and preserves unrelated scores", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-score-gateway-touch-"));
  const dataDir = join(cwd, "data");
  const now = Date.now();
  const iso = (offsetMs) => new Date(now + offsetMs).toISOString();
  const bobBaseRoute = { srcChain: "bob", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const baseBobRoute = { srcChain: "base", dstChain: "bob", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const ethereumBaseRoute = { srcChain: "ethereum", dstChain: "base", srcToken: WBTC_OFT, dstToken: WBTC_OFT };
  const untouchedStableRoute = { srcChain: "base", dstChain: "ethereum", srcToken: USDC_BASE, dstToken: USDC_ETHEREUM };
  const bobBaseRouteKey = `${bobBaseRoute.srcChain}:${bobBaseRoute.srcToken}->${bobBaseRoute.dstChain}:${bobBaseRoute.dstToken}`;
  const baseBobRouteKey = `${baseBobRoute.srcChain}:${baseBobRoute.srcToken}->${baseBobRoute.dstChain}:${baseBobRoute.dstToken}`;
  const ethereumBaseRouteKey = `${ethereumBaseRoute.srcChain}:${ethereumBaseRoute.srcToken}->${ethereumBaseRoute.dstChain}:${ethereumBaseRoute.dstToken}`;
  const untouchedStableRouteKey = `${untouchedStableRoute.srcChain}:${untouchedStableRoute.srcToken}->${untouchedStableRoute.dstChain}:${untouchedStableRoute.dstToken}`;

  await writeJsonl(dataDir, "gateway-quotes", [
    quote({ observedAt: iso(-60_000), route: bobBaseRoute, outputAmount: "12000" }),
    quote({ observedAt: iso(-55_000), route: baseBobRoute, outputAmount: "11900" }),
    quote({ observedAt: iso(-50_000), route: ethereumBaseRoute, outputAmount: "11850" }),
    quote({ observedAt: iso(-45_000), route: untouchedStableRoute, inputAmount: "1000000", outputAmount: "1000000" }),
  ]);
  await writeJsonl(dataDir, "gateway-quote-failures", []);
  await writeJsonl(dataDir, "dex-quotes", []);
  await writeJsonl(dataDir, "bitcoin-fee-snapshots", [{ observedAt: iso(-120_000), btcUsd: 50000 }]);
  await writeJsonl(dataDir, "gateway-gas-estimates", [
    { observedAt: iso(-90_000), routeKey: bobBaseRouteKey, amount: "10000", estimatedGasUsd: 0.001 },
    { observedAt: iso(-90_000), routeKey: baseBobRouteKey, amount: "10000", estimatedGasUsd: 0.001 },
    { observedAt: iso(-90_000), routeKey: ethereumBaseRouteKey, amount: "10000", estimatedGasUsd: 0.001 },
    { observedAt: iso(-90_000), routeKey: untouchedStableRouteKey, amount: "10000", estimatedGasUsd: 0.02 },
  ]);
  await writeJsonl(dataDir, "gas-snapshots", [
    { observedAt: iso(-120_000), chain: "bob", nativeUsd: 3000, gasPriceWei: "1000000000", fallbackGasUnits: 21000 },
    { observedAt: iso(-120_000), chain: "base", nativeUsd: 3000, gasPriceWei: "1000000000", fallbackGasUnits: 21000 },
    { observedAt: iso(-120_000), chain: "ethereum", nativeUsd: 3000, gasPriceWei: "1000000000", fallbackGasUnits: 21000 },
  ]);
  await writeFile(
    join(dataDir, "gateway-scores.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: iso(-150_000),
      priceObservedAt: iso(-150_000),
      btcUsd: 50000,
      scoredQuotes: 4,
      summary: { shadowCandidates: 0, dexBacked: 0, insufficientData: 0, highFailureRate: 0, staleGas: 0, missingDecimals: 0 },
      scores: [
        { routeKey: bobBaseRouteKey, amount: "10000", netEdgeUsd: -0.5, tradeReadiness: "reject_no_net_edge", dataGaps: [], routeStats: { failureRate: 0 }, dex: null, observedAt: iso(-180_000) },
        { routeKey: baseBobRouteKey, amount: "10000", netEdgeUsd: -0.4, tradeReadiness: "reject_no_net_edge", dataGaps: [], routeStats: { failureRate: 0 }, dex: null, observedAt: iso(-180_000) },
        { routeKey: ethereumBaseRouteKey, amount: "10000", netEdgeUsd: -0.3, tradeReadiness: "reject_no_net_edge", dataGaps: [], routeStats: { failureRate: 0 }, dex: null, observedAt: iso(-180_000) },
        { routeKey: untouchedStableRouteKey, amount: "10000", netEdgeUsd: 0.2, tradeReadiness: "shadow_candidate_review_only", dataGaps: [], routeStats: { failureRate: 0 }, dex: null, observedAt: iso(-240_000) },
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  const result = spawnSync(
    process.execPath,
    [join(ROOT, "src/cli/score-gateway.mjs"), "--write", "--touch-chains=bob,base"],
    {
      cwd,
      env: { ...process.env, BOB_CLAW_DATA_DIR: dataDir },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /selection touchChains=bob,base refreshed=3/);

  const snapshot = JSON.parse(await readFile(join(dataDir, "gateway-scores.json"), "utf8"));
  assert.equal(snapshot.scoredQuotes, 4);
  assert.equal(snapshot.scores.find((item) => item.routeKey === bobBaseRouteKey).observedAt, iso(-60_000));
  assert.equal(snapshot.scores.find((item) => item.routeKey === baseBobRouteKey).observedAt, iso(-55_000));
  assert.equal(snapshot.scores.find((item) => item.routeKey === ethereumBaseRouteKey).observedAt, iso(-50_000));
  assert.equal(snapshot.scores.find((item) => item.routeKey === untouchedStableRouteKey).observedAt, iso(-240_000));
});
