import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface } from "ethers";
import { buildAcrossBridgePlan, executeAcrossBridgePlan } from "../src/executor/helpers/across-bridge.mjs";
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

async function codeReaderOk() {
  return { code: "0x01", hasCode: true, rpcUrl: "mock:rpc" };
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
    readCodeImpl: codeReaderOk,
    estimateGasImpl: async () => ({ gasUnits: "150000", gasPriceWei: "1000000000" }),
  });
  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.executionReady, true);
  assert.equal(plan.spokePool, acrossSpokePool("base"));
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].id, "approve_across_spokepool");
  assert.equal(plan.steps[0].intent.intentType, "approve_exact");
  assert.equal(plan.steps[0].intent.approval.mode, "per_tx");
  assert.equal(plan.steps[0].intent.approval.amount, "100000000");
  assert.equal(plan.steps[1].id, "across_deposit_v3");
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
    readCodeImpl: codeReaderOk,
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
    readCodeImpl: codeReaderOk,
    estimateGasImpl: async () => ({ gasUnits: "150000", gasPriceWei: "1000000000" }),
  });
  assert.equal(plan.planStatus, "blocked");
  assert.equal(plan.blockedReason, "across_quote_rejected");
  assert.equal(plan.executionReady, false);
});

test("buildAcrossBridgePlan uses fallback deposit gas when pre-approval estimate reverts", async () => {
  let estimateCount = 0;
  const plan = await buildAcrossBridgePlan({
    srcChain: "base",
    dstChain: "optimism",
    ticker: "usdc",
    amount: "100000000",
    senderAddress: SENDER,
    clientFactory: mockClientFactory(okBody()),
    priceReader: async () => ({ "base:usdc": 1, "optimism:usdc": 1 }),
    readCodeImpl: codeReaderOk,
    estimateGasImpl: async () => {
      estimateCount += 1;
      if (estimateCount === 1) return { gasUnits: "50000", gasPriceWei: "1000000000", rpcUrl: "mock:base" };
      const error = new Error("All RPC endpoints failed gas estimate for chain: base");
      error.name = "GasEstimateError";
      error.attempts = [{ message: "execution reverted: insufficient allowance" }];
      throw error;
    },
  });

  assert.equal(plan.planStatus, "ready");
  assert.equal(plan.approvalGasPreflight.gasLimit, "60000");
  assert.equal(plan.gasPreflight.fallback, true);
  assert.equal(plan.gasPreflight.fallbackReason, "deposit_estimate_reverted_before_approval");
  assert.equal(plan.steps[1].intent.tx.gasLimit, "540000");
});

test("buildAcrossBridgePlan blocks when source SpokePool has no contract code", async () => {
  const plan = await buildAcrossBridgePlan({
    srcChain: "base",
    dstChain: "optimism",
    ticker: "usdc",
    amount: "100000000",
    senderAddress: SENDER,
    clientFactory: mockClientFactory(okBody()),
    priceReader: async () => ({ "base:usdc": 1, "optimism:usdc": 1 }),
    readCodeImpl: async (_chain, address) => ({
      code: address.toLowerCase() === acrossSpokePool("base").toLowerCase() ? "0x" : "0x01",
      hasCode: address.toLowerCase() !== acrossSpokePool("base").toLowerCase(),
      rpcUrl: "mock:rpc",
    }),
    estimateGasImpl: async () => {
      throw new Error("estimateGas should not run for no-code SpokePool");
    },
  });

  assert.equal(plan.planStatus, "blocked");
  assert.equal(plan.blockedReason, "across_spokepool_code_missing");
  assert.equal(plan.executionReady, false);
  assert.equal(plan.preflightError.name, "ContractCodeMissing");
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

test("executeAcrossBridgePlan sends signer intent and waits for destination token delta", async () => {
  const plan = await buildAcrossBridgePlan({
    srcChain: "base",
    dstChain: "optimism",
    ticker: "usdc",
    amount: "100000000",
    senderAddress: SENDER,
    clientFactory: mockClientFactory(okBody()),
    priceReader: async () => ({ "base:usdc": 1, "optimism:usdc": 1 }),
    readCodeImpl: codeReaderOk,
    estimateGasImpl: async () => ({ gasUnits: "150000", gasPriceWei: "1000000000" }),
  });
  const srcToken = acrossTokenAddress("base", "usdc").toLowerCase();
  const dstToken = acrossTokenAddress("optimism", "usdc").toLowerCase();
  const balances = {
    [`base:${srcToken}`]: ["100000000", "0"],
    [`optimism:${dstToken}`]: ["0", "99000000"],
  };
  const signerMessages = [];
  const execution = await executeAcrossBridgePlan({
    plan,
    sendCommand: async ({ message }) => {
      signerMessages.push(message);
      return {
        status: "ok",
        broadcast: { txHash: "0xacross" },
        receipt: { status: 1, gasUsed: "150000", effectiveGasPrice: "1000000000" },
        signed: { metadata: { from: SENDER, to: plan.spokePool, nonce: 7 } },
      };
    },
    readErc20BalanceImpl: async (chain, token) => {
      const key = `${chain}:${String(token).toLowerCase()}`;
      const queue = balances[key];
      assert.ok(queue, `unexpected balance read ${key}`);
      const value = queue.length > 1 ? queue.shift() : queue[0];
      return { rpcUrl: `mock:${chain}`, balance: value };
    },
    receiptIngest: async ({ execution: ingested }) => ({
      appended: true,
      reason: "ingested",
      txHash: ingested.signerResult.broadcast.txHash,
    }),
    destinationPollIntervalMs: 0,
    sleepImpl: async () => {},
  });

  assert.equal(signerMessages.length, 2);
  assert.equal(signerMessages[0].command, "sign_and_broadcast");
  assert.equal(signerMessages[0].intent.intentType, "approve_exact");
  assert.equal(signerMessages[1].intent.intentType, "across_bridge_deposit");
  assert.equal(execution.settlementStatus, "delivered");
  assert.equal(execution.destinationProof.observedDelta, "99000000");
  assert.deepEqual(execution.stepResults.map((item) => item.id), ["approve_across_spokepool", "across_deposit_v3"]);
  assert.equal(execution.receiptIngest.appended, true);
});

test("executeAcrossBridgePlan blocks before signing when source balance is below input amount", async () => {
  const plan = await buildAcrossBridgePlan({
    srcChain: "base",
    dstChain: "optimism",
    ticker: "usdc",
    amount: "100000000",
    senderAddress: SENDER,
    clientFactory: mockClientFactory(okBody()),
    priceReader: async () => ({ "base:usdc": 1, "optimism:usdc": 1 }),
    readCodeImpl: codeReaderOk,
    estimateGasImpl: async () => ({ gasUnits: "150000", gasPriceWei: "1000000000" }),
  });
  let signerCalled = false;
  let caught = null;
  try {
    await executeAcrossBridgePlan({
      plan,
      sendCommand: async () => {
        signerCalled = true;
        return { status: "ok", broadcast: { txHash: "0xshould-not-run" } };
      },
      readErc20BalanceImpl: async (chain, token) => {
        const normalized = String(token).toLowerCase();
        if (chain === "base" && normalized === acrossTokenAddress("base", "usdc").toLowerCase()) {
          return { rpcUrl: "mock:base", balance: "50000000" };
        }
        return { rpcUrl: `mock:${chain}`, balance: "0" };
      },
    });
  } catch (error) {
    caught = error;
  }

  assert.equal(signerCalled, false);
  assert.equal(caught?.name, "InsufficientSourceBalance");
  assert.equal(caught.partialExecution.blockedReason, "insufficient_source_balance");
  assert.equal(caught.partialExecution.error.requiredAmount, "100000000");
});
