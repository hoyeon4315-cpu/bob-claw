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
