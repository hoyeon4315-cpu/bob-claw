import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN, WRAPPED_NATIVE_TOKENS } from "../src/assets/tokens.mjs";
import {
  applyOutputAssetLocks,
  applyPersistentSweepState,
  buildLiveCanaryCandidates,
  decimalToUnits,
  preflightLiveCanarySweep,
  runLiveCanarySweep,
  updateLiveCanarySweepStateFromResults,
} from "../src/executor/live-canary-sweep.mjs";

const ADDRESS = "0x1111111111111111111111111111111111111111";

function readyPreflight() {
  return {
    status: "ready",
    senderAddress: ADDRESS,
    bitcoinAddress: "bc1qexample",
    killSwitchPath: "/tmp/kill",
    liveBaseline: {
      status: "ready",
      liveTrading: "ALLOWED",
    },
  };
}

test("decimalToUnits converts decimal probe sizes without floating point drift", () => {
  assert.equal(decimalToUnits("0.1", 6).toString(), "100000");
  assert.equal(decimalToUnits("1.25", 18).toString(), "1250000000000000000");
});

test("candidate builder uses current inventory and reserves wrapped BTC for Gateway/payback", () => {
  const candidates = buildLiveCanaryCandidates({
    inventory: {
      tokenBalances: [
        {
          chain: "bsc",
          token: "0x55d398326f99059fF775485246999027B3197955",
          ticker: "USDT",
          family: "stablecoin",
          balance: "320000000000000000000",
          estimatedUsd: 320,
        },
        {
          chain: "base",
          token: WBTC_OFT_TOKEN,
          ticker: "wBTC.OFT",
          family: "wrapped_btc",
          balance: "5296",
          estimatedUsd: 4.1,
        },
      ],
      native: [],
    },
    tinyUsd: 0.1,
  });

  const bsc = candidates.find((item) => item.chain === "bsc");
  const base = candidates.find((item) => item.chain === "base");
  assert.equal(bsc.status, "candidate");
  assert.equal(bsc.outputToken, WRAPPED_NATIVE_TOKENS.bsc);
  assert.equal(bsc.amount, "100000000000000000");
  assert.equal(base.status, "blocked");
  assert.equal(base.blockedReason, "wrapped_btc_reserved_for_gateway_or_payback");
});

test("output asset lock prevents same-run balance-delta proof collisions", () => {
  const locked = applyOutputAssetLocks([
    {
      id: "a",
      status: "candidate",
      kind: "token_dex",
      chain: "base",
      outputToken: "0x4200000000000000000000000000000000000006",
    },
    {
      id: "b",
      status: "candidate",
      kind: "native_dex",
      chain: "base",
      outputToken: "0x4200000000000000000000000000000000000006",
    },
  ]);

  assert.equal(locked[0].status, "candidate");
  assert.equal(locked[1].status, "blocked");
  assert.equal(locked[1].blockedReason, "output_asset_already_touched_in_run");
});

test("preflight blocks when kill switch file is present", async () => {
  const result = await preflightLiveCanarySweep({
    killSwitchPath: "/tmp/kill",
    killSwitchExistsImpl: () => true,
    readSignerHealthImpl: async () => {
      throw new Error("should not be called");
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.blockedReason, "kill_switch_present");
});

test("sweep continues after per-candidate plan blocker and quarantines signer-uncertain chain", async () => {
  const inventory = {
    observedAt: "2026-04-23T00:00:00.000Z",
    totalUsd: 2,
    tokenBalances: [
      {
        chain: "base",
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        ticker: "USDC",
        family: "stablecoin",
        balance: "1000000",
        estimatedUsd: 1,
      },
      {
        chain: "sonic",
        token: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894",
        ticker: "USDC",
        family: "stablecoin",
        balance: "1000000",
        estimatedUsd: 1,
      },
    ],
    native: [],
    summary: { nativeCount: 0, tokenCount: 2, scanErrorCount: 0 },
    scanErrors: [],
  };

  const report = await runLiveCanarySweep({
    execute: true,
    inventory,
    preflightImpl: async () => readyPreflight(),
    buildTokenDexPlanImpl: async ({ chain }) => {
      if (chain === "base") {
        return { planStatus: "blocked", blockedReason: "routing_unavailable", chain, steps: [] };
      }
      return {
        strategyId: "token-dex-experiment",
        planStatus: "ready",
        chain,
        inputToken: "in",
        outputToken: "out",
        amount: "100000",
        amountUsd: 0.1,
        minimumOutputAmount: "1",
        steps: [{ id: "approve" }, { id: "swap" }],
      };
    },
    executeTokenDexPlanImpl: async () => {
      throw new Error("Signer daemon response timed out after 30000ms");
    },
    now: "2026-04-23T00:00:00.000Z",
  });

  assert.equal(report.status, "completed");
  assert.equal(report.results[0].status, "blocked");
  assert.equal(report.results[0].blockedReason, "routing_unavailable");
  assert.equal(report.results[1].status, "execution_failed");
  assert.equal(report.results[1].blockedReason, "chain_quarantine_after_receipt_uncertainty");
  assert.equal(report.results[1].quarantineChain, "sonic");
  assert.equal(report.summary.globalStopReason, null);
  assert.equal(report.summary.quarantinedCount, 1);
  assert.equal(report.state.quarantinedChains.sonic.reason, "chain_quarantine_after_receipt_uncertainty");
});

test("sweep limit counts only executable candidates, not plan blockers", async () => {
  const inventory = {
    observedAt: "2026-04-23T00:00:00.000Z",
    totalUsd: 6,
    tokenBalances: [
      {
        chain: "base",
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        ticker: "USDC",
        family: "stablecoin",
        balance: "3000000",
        estimatedUsd: 3,
      },
      {
        chain: "bsc",
        token: "0x55d398326f99059fF775485246999027B3197955",
        ticker: "USDT",
        family: "stablecoin",
        balance: "2000000000000000000",
        estimatedUsd: 2,
      },
      {
        chain: "sonic",
        token: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894",
        ticker: "USDC",
        family: "stablecoin",
        balance: "1000000",
        estimatedUsd: 1,
      },
    ],
    native: [],
    summary: { nativeCount: 0, tokenCount: 3, scanErrorCount: 0 },
    scanErrors: [],
  };

  const seenChains = [];
  const report = await runLiveCanarySweep({
    limit: 1,
    inventory,
    preflightImpl: async () => readyPreflight(),
    buildTokenDexPlanImpl: async ({ chain }) => {
      seenChains.push(chain);
      if (chain !== "sonic") {
        return { planStatus: "blocked", blockedReason: "routing_unavailable", chain, steps: [] };
      }
      return {
        strategyId: "token-dex-experiment",
        planStatus: "ready",
        chain,
        inputToken: "in",
        outputToken: "out",
        amount: "100000",
        amountUsd: 0.1,
        minimumOutputAmount: "1",
        steps: [{ id: "approve" }, { id: "swap" }],
      };
    },
    now: "2026-04-23T00:00:00.000Z",
  });

  assert.deepEqual(seenChains, ["base", "bsc", "sonic"]);
  assert.equal(report.status, "completed");
  assert.equal(report.results[0].status, "blocked");
  assert.equal(report.results[1].status, "blocked");
  assert.equal(report.results[2].status, "preview_ready");
  assert.equal(report.summary.previewReadyCount, 1);
});

test("persistent sweep state blocks quarantined chains and cooled output assets", () => {
  const now = "2026-04-23T00:00:00.000Z";
  const candidates = applyPersistentSweepState([
    {
      id: "base",
      status: "candidate",
      kind: "token_dex",
      chain: "base",
      outputToken: "0x4200000000000000000000000000000000000006",
    },
    {
      id: "sonic",
      status: "candidate",
      kind: "token_dex",
      chain: "sonic",
      outputToken: "0x039e2fb66102314ce7b64ce5ce3e5183bc94ad38",
    },
  ], {
    quarantinedChains: {
      sonic: { until: "2026-04-23T00:30:00.000Z", reason: "receipt_uncertain" },
    },
    outputAssetCooldowns: {
      "base:0x4200000000000000000000000000000000000006": {
        until: "2026-04-23T00:10:00.000Z",
        reason: "output_asset_touched",
      },
    },
  }, { now });

  assert.equal(candidates[0].status, "blocked");
  assert.equal(candidates[0].blockedReason, "output_asset_cooldown_active");
  assert.equal(candidates[1].status, "blocked");
  assert.equal(candidates[1].blockedReason, "chain_quarantined_after_uncertain_receipt");
});

test("sweep state records output cooldowns for touched assets", () => {
  const state = updateLiveCanarySweepStateFromResults({
    results: [
      {
        status: "source_confirmed_only",
        candidate: {
          id: "token_dex:base:usdc->base:weth",
          chain: "base",
          outputToken: "0x4200000000000000000000000000000000000006",
        },
        execution: { lastTxHash: "0xabc" },
      },
    ],
    now: "2026-04-23T00:00:00.000Z",
    outputAssetCooldownMs: 60_000,
  });

  const key = "base:0x4200000000000000000000000000000000000006";
  assert.equal(state.outputAssetCooldowns[key].lastTxHash, "0xabc");
  assert.equal(state.outputAssetCooldowns[key].until, "2026-04-23T00:01:00.000Z");
});
