import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { trustedOdosQuote } from "./helpers/trusted-odos-quote.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ZERO = "0x0000000000000000000000000000000000000000";

async function writeJsonl(baseDir, name, records) {
  await mkdir(baseDir, { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(join(baseDir, `${name}.jsonl`), body ? `${body}\n` : "", "utf8");
}

test("analyze-ethereum-routes reports capability, policy block, and writes JSON output", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-eth-analysis-"));
  const dataDir = join(cwd, "data");
  await mkdir(dataDir, { recursive: true });

  await writeJsonl(dataDir, "gateway-routes", [
    {
      observedAt: "2026-04-10T00:00:00.000Z",
      routes: [
        { srcChain: "bitcoin", srcToken: ZERO, dstChain: "ethereum", dstToken: ZERO },
        { srcChain: "bitcoin", srcToken: ZERO, dstChain: "base", dstToken: ZERO },
        { srcChain: "base", srcToken: ZERO, dstChain: "ethereum", dstToken: ZERO },
      ],
    },
    {
      observedAt: "2026-04-11T00:00:00.000Z",
      routes: [
        { srcChain: "bitcoin", srcToken: ZERO, dstChain: "ethereum", dstToken: ZERO },
        { srcChain: "bitcoin", srcToken: ZERO, dstChain: "base", dstToken: ZERO },
        { srcChain: "base", srcToken: ZERO, dstChain: "ethereum", dstToken: ZERO },
      ],
    },
    {
      observedAt: "2026-04-13T00:00:00.000Z",
      routes: [
        { srcChain: "bitcoin", srcToken: ZERO, dstChain: "ethereum", dstToken: ZERO },
        { srcChain: "bitcoin", srcToken: ZERO, dstChain: "base", dstToken: ZERO },
        { srcChain: "base", srcToken: ZERO, dstChain: "ethereum", dstToken: ZERO },
      ],
    },
  ]);
  await writeJsonl(dataDir, "gateway-quotes", [
    {
      observedAt: "2026-04-13T00:01:00.000Z",
      routeKey: `bitcoin:${ZERO}->ethereum:${ZERO}`,
      route: { srcChain: "bitcoin", srcToken: ZERO, dstChain: "ethereum", dstToken: ZERO },
      amount: "10000",
      latencyMs: 1100,
      feeRatio: 0.01,
    },
    {
      observedAt: "2026-04-13T02:01:00.000Z",
      routeKey: `bitcoin:${ZERO}->base:${ZERO}`,
      route: { srcChain: "bitcoin", srcToken: ZERO, dstChain: "base", dstToken: ZERO },
      amount: "10000",
      latencyMs: 900,
      feeRatio: 0.008,
    },
    {
      observedAt: "2026-04-13T02:03:00.000Z",
      routeKey: `base:${ZERO}->ethereum:${ZERO}`,
      route: { srcChain: "base", srcToken: ZERO, dstChain: "ethereum", dstToken: ZERO },
      amount: "10000",
      latencyMs: 700,
      feeRatio: 0.006,
    },
  ]);
  await writeJsonl(dataDir, "gateway-quote-failures", [
    {
      observedAt: "2026-04-13T03:01:00.000Z",
      routeKey: `bitcoin:${ZERO}->ethereum:${ZERO}`,
      route: { srcChain: "bitcoin", srcToken: ZERO, dstChain: "ethereum", dstToken: ZERO },
      reason: "timeout",
    },
  ]);
  await writeJsonl(dataDir, "dex-quotes", [
    trustedOdosQuote({
      observedAt: "2026-04-13T00:05:00.000Z",
      chain: "base",
      inputTicker: "ETH",
      outputTicker: "USDC",
      gatewayRouteKey: `bitcoin:${ZERO}->base:${ZERO}`,
    }),
    trustedOdosQuote({
      observedAt: "2026-04-13T02:05:00.000Z",
      chain: "base",
      inputTicker: "USDC",
      outputTicker: "ETH",
      source: "gateway_src_entry_leg",
      gatewayRouteKey: `base:${ZERO}->ethereum:${ZERO}`,
      gatewayAmount: "10000",
      inputValueUsd: 7.4,
      gasEstimateValueUsd: 0.03,
      outputAmount: "2000000000000000",
    }),
    trustedOdosQuote({
      observedAt: "2026-04-13T02:05:30.000Z",
      chain: "ethereum",
      inputTicker: "ETH",
      outputTicker: "USDC",
      source: "gateway_dst_leg",
      gatewayRouteKey: `base:${ZERO}->ethereum:${ZERO}`,
      gatewayAmount: "10000",
    }),
  ]);
  await writeJsonl(dataDir, "gateway-shadow-observations", [
    {
      observedAt: "2026-04-11T01:00:00.000Z",
      routeKey: `base:${ZERO}->ethereum:${ZERO}`,
      amount: "10000",
      latencyMs: 750,
      executionGasUsd: 0.03,
    },
    {
      observedAt: "2026-04-12T04:00:00.000Z",
      routeKey: `base:${ZERO}->ethereum:${ZERO}`,
      amount: "25000",
      latencyMs: 810,
      executionGasUsd: 0.04,
    },
  ]);
  await writeFile(
    join(dataDir, "gateway-scores.json"),
    `${JSON.stringify({
      scores: [
        {
          observedAt: "2026-04-13T00:02:00.000Z",
          routeKey: `bitcoin:${ZERO}->ethereum:${ZERO}`,
          srcChain: "bitcoin",
          srcToken: ZERO,
          dstChain: "ethereum",
          dstToken: ZERO,
          amount: "10000",
          tradeReadiness: "observe_only_ethereum_l1_phase_disabled",
          netEdgeUsd: -2.4,
          executableNetEdgeUsd: null,
          knownCostUsd: 0.5,
        },
        {
          observedAt: "2026-04-13T02:02:00.000Z",
          routeKey: `bitcoin:${ZERO}->base:${ZERO}`,
          srcChain: "bitcoin",
          srcToken: ZERO,
          dstChain: "base",
          dstToken: ZERO,
          amount: "10000",
          tradeReadiness: "observe_only_slow_settlement",
          netEdgeUsd: -1.5,
          executableNetEdgeUsd: null,
          knownCostUsd: 0.4,
        },
        {
          observedAt: "2026-04-13T02:04:00.000Z",
          routeKey: `base:${ZERO}->ethereum:${ZERO}`,
          srcChain: "base",
          srcToken: ZERO,
          dstChain: "ethereum",
          dstToken: ZERO,
          amount: "10000",
          srcAsset: { ticker: "ETH", family: "native_or_wrapped", priceKey: "ethereum", decimals: 18 },
          dstAsset: { ticker: "ETH", family: "native_or_wrapped", priceKey: "ethereum", decimals: 18 },
          inputAmount: 0.002,
          tradeReadiness: "observe_only_ethereum_l1_phase_disabled",
          netEdgeUsd: -0.7,
          executableOutputUsd: 7.83,
          executableNetEdgeUsd: -0.4,
          knownCostUsd: 0.2,
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  const result = spawnSync(process.execPath, [join(ROOT, "src/cli/analyze-ethereum-routes.mjs"), "--json", "--write"], {
    cwd,
    env: {
      ...process.env,
      BOB_CLAW_DATA_DIR: dataDir,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const analysis = JSON.parse(result.stdout);
  const written = JSON.parse(await readFile(join(dataDir, "ethereum-route-analysis.json"), "utf8"));

  assert.equal(analysis.capability.gatewayRouteCount, 3);
  assert.equal(analysis.capability.ethereumL1RouteCount, 2);
  assert.equal(analysis.capability.nativeEthRouteCount, 3);
  assert.equal(analysis.capability.ethFamilyRouteCount, 1);
  assert.equal(analysis.ethFamily.persistence.snapshotCount, 3);
  assert.equal(analysis.ethFamily.persistence.stableRouteCount, 1);
  assert.equal(analysis.ethFamily.routeUniverse.ethFamilyRouteCount, 1);
  assert.equal(analysis.ethFamily.routeFocus.loopObservableCount, 1);
  assert.equal(analysis.ethFamily.gatewayArbitrage.measuredNetLoopCount, 1);
  assert.equal(analysis.ethFamily.viability.policyBlockedLoopCount, 1);
  assert.equal(analysis.ethFamily.viability.measuredLoopCount, 0);
  assert.equal(analysis.ethFamily.verdict.code, "no_measured_loops");
  assert.equal(analysis.scores.policyBlockedCount, 2);
  assert.equal(analysis.recommendation.code, "observe_only_until_fee_review");
  assert.equal(written.scores.tradeReadiness.observe_only_ethereum_l1_phase_disabled, 2);
});
