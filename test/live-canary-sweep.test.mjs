import assert from "node:assert/strict";
import { test } from "node:test";
import { WBTC_OFT_TOKEN, WRAPPED_NATIVE_TOKENS } from "../src/assets/tokens.mjs";
import {
  applyOutputAssetLocks,
  buildLiveCanaryCandidates,
  decimalToUnits,
  preflightLiveCanarySweep,
  runLiveCanarySweep,
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

test("sweep continues after per-candidate plan blocker but stops after signer uncertainty", async () => {
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

  assert.equal(report.status, "stopped");
  assert.equal(report.results[0].status, "blocked");
  assert.equal(report.results[0].blockedReason, "routing_unavailable");
  assert.equal(report.results[1].status, "execution_failed");
  assert.equal(report.summary.globalStopReason, "global_safety_stop_after_execution_error");
});
