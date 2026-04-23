import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface } from "ethers";
import { buildAcrossBridgePlan } from "../src/executor/helpers/across-bridge.mjs";
import { SPOKE_POOL_DEPOSIT_ABI } from "../src/bridge/across/spoke-pool-abi.mjs";
import { acrossSpokePool, acrossTokenAddress } from "../src/config/across.mjs";

const IFACE = new Interface(SPOKE_POOL_DEPOSIT_ABI);
const SENDER = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";

function mockClientFactory(body) {
  return () => ({
    async suggestedFees() {
      return { status: 200, body, latencyMs: 5 };
    },
  });
}

function okBody({ outputAmount = "99000000", relayPct = "1000000000000000", timestamp } = {}) {
  return {
    totalRelayFee: { pct: relayPct, total: "0" },
    lpFee: { pct: "0" },
    outputAmount,
    timestamp: timestamp ?? Math.floor(Date.now() / 1000),
    exclusiveRelayer: "0x0000000000000000000000000000000000000000",
    exclusivityDeadline: 0,
  };
}

test("buildAcrossBridgePlan produces ready intent with encoded calldata", async () => {
  const plan = await buildAcrossBridgePlan({
    srcChain: "base",
    dstChain: "optimism",
    ticker: "usdc",
    amount: "100000000",
    senderAddress: SENDER,
    clientFactory: mockClientFactory(okBody()),
    priceReader: async () => ({ "base:usdc": 1, "optimism:usdc": 1 }),
    estimateGasImpl: async () => ({ gasUnits: "150000", gasPriceWei: "1000000000" }),
  });
  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.executionReady, true);
  assert.equal(plan.spokePool, acrossSpokePool("base"));
  assert.ok(plan.intent.tx.data.startsWith("0x"));
  const decoded = IFACE.decodeFunctionData("depositV3", plan.intent.tx.data);
  assert.equal(decoded[0].toLowerCase(), SENDER.toLowerCase());
  assert.equal(decoded[2].toLowerCase(), acrossTokenAddress("base", "usdc").toLowerCase());
  assert.equal(decoded[3].toLowerCase(), acrossTokenAddress("optimism", "usdc").toLowerCase());
  assert.equal(BigInt(decoded[4]), 100000000n);
});

test("buildAcrossBridgePlan enforces perTxMaxUsd cap", async () => {
  const plan = await buildAcrossBridgePlan({
    srcChain: "base",
    dstChain: "optimism",
    ticker: "usdc",
    amount: "600000000",
    senderAddress: SENDER,
    clientFactory: mockClientFactory(okBody({ outputAmount: "594000000" })),
    priceReader: async () => ({ "base:usdc": 1, "optimism:usdc": 1 }),
    estimateGasImpl: async () => ({ gasUnits: "150000", gasPriceWei: "1000000000" }),
  });
  assert.equal(plan.planStatus, "blocked");
  assert.equal(plan.blockedReason, "across_per_tx_cap_exceeded");
});

test("buildAcrossBridgePlan surfaces quote failure", async () => {
  const plan = await buildAcrossBridgePlan({
    srcChain: "base",
    dstChain: "optimism",
    ticker: "usdc",
    amount: "100000000",
    senderAddress: SENDER,
    clientFactory: () => ({
      async suggestedFees() {
        const err = new Error("bad pair");
        err.name = "AcrossError";
        throw err;
      },
    }),
    priceReader: async () => ({ "base:usdc": 1 }),
    estimateGasImpl: async () => ({ gasUnits: "150000", gasPriceWei: "1000000000" }),
  });
  assert.equal(plan.planStatus, "blocked");
  assert.equal(plan.blockedReason, "across_quote_rejected");
  assert.equal(plan.executionReady, false);
});

test("buildAcrossBridgePlan rejects unsupported pair", async () => {
  await assert.rejects(
    buildAcrossBridgePlan({
      srcChain: "bob",
      dstChain: "base",
      ticker: "usdc",
      amount: "100000000",
      senderAddress: SENDER,
    }),
    /pair unsupported/,
  );
});
