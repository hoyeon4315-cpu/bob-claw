import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface, Transaction } from "ethers";

import { EvmLocalKeySigner, validateEvmTransactionSemantics } from "../src/executor/signer/evm-local-signer.mjs";

const PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ERC20 = new Interface(["function approve(address spender,uint256 amount)"]);

function buildProvider({
  pendingNonce = 12,
  nativeBalanceWei = 10n ** 18n,
  feeData = {
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
    gasPrice: null,
  },
  feeDataError = null,
  broadcastError = null,
  waitError = null,
  txHash = "0x" + "a".repeat(64),
  calls = null,
  label = "provider",
} = {}) {
  let nextPendingNonce = pendingNonce;
  return {
    setPendingNonce(value) {
      nextPendingNonce = value;
    },
    getFeeData: async () => {
      calls?.push(`${label}:fee`);
      if (feeDataError) throw feeDataError;
      return feeData;
    },
    getBalance: async (_address, blockTag) => {
      calls?.push(`${label}:balance`);
      assert.equal(blockTag, "latest");
      return nativeBalanceWei;
    },
    getTransactionCount: async (_address, blockTag) => {
      calls?.push(`${label}:nonce`);
      assert.equal(blockTag, "pending");
      return nextPendingNonce;
    },
    broadcastTransaction: async (signedTx) => {
      calls?.push(`${label}:broadcast`);
      if (broadcastError) throw broadcastError;
      return {
        hash: txHash,
        nonce: nextPendingNonce,
        from: "0x0000000000000000000000000000000000000000",
        to: "0x0000000000000000000000000000000000000001",
        signedTx,
      };
    },
    waitForTransaction: async (hash, confirmations, timeoutMs) => {
      calls?.push(`${label}:wait`);
      if (waitError) throw waitError;
      return {
        hash,
        confirmations,
        timeoutMs,
        status: 1,
      };
    },
  };
}

function signedTransaction(envelope) {
  return Transaction.from(envelope.signedTx);
}

function buildSigner(provider) {
  return new EvmLocalKeySigner({
    keyReader: async () => PRIVATE_KEY,
    providerFactory: () => provider,
  });
}

function intent() {
  return {
    family: "evm",
    chain: "base",
    strategyId: "wrapped-btc-loop-base-moonwell",
    intentType: "wrapped_btc_loop_entry",
    amountUsd: 1,
    mode: "live",
    tx: {
      to: "0x0000000000000000000000000000000000000001",
      data: "0x",
      value: "0",
      gasLimit: "21000",
    },
  };
}

test("evm signer sign-only mode does not consume the sequential nonce manager", async () => {
  const signer = buildSigner(buildProvider({ pendingNonce: 12 }));

  const firstPreview = await signer.signIntent(intent(), { reserveNonce: false });
  const secondPreview = await signer.signIntent(intent(), { reserveNonce: false });
  const firstBroadcastable = await signer.signIntent(intent(), { reserveNonce: true });
  const secondBroadcastable = await signer.signIntent(intent(), { reserveNonce: true });

  assert.equal(firstPreview.metadata.nonce, 12);
  assert.equal(secondPreview.metadata.nonce, 12);
  assert.equal(firstBroadcastable.metadata.nonce, 12);
  assert.equal(secondBroadcastable.metadata.nonce, 13);
});

test("evm signer catches up when chain pending nonce advances externally", async () => {
  const provider = buildProvider({ pendingNonce: 20 });
  const signer = buildSigner(provider);

  const first = await signer.signIntent(intent(), { reserveNonce: true });
  provider.setPendingNonce(23);
  const caughtUp = await signer.signIntent(intent(), { reserveNonce: true });
  const next = await signer.signIntent(intent(), { reserveNonce: true });

  assert.equal(first.metadata.nonce, 20);
  assert.equal(caughtUp.metadata.nonce, 23);
  assert.equal(next.metadata.nonce, 24);
});

test("evm signer buffers low ethereum eip1559 fee data for mempool acceptance", async () => {
  const provider = buildProvider({
    feeData: {
      maxFeePerGas: 300_000_000n,
      maxPriorityFeePerGas: 150_000n,
      gasPrice: null,
    },
  });
  const signer = buildSigner(provider);

  const signed = await signer.signIntent({ ...intent(), chain: "ethereum" }, { reserveNonce: true });
  const tx = signedTransaction(signed);

  assert.equal(tx.maxPriorityFeePerGas, 500_000_000n);
  assert.equal(tx.maxFeePerGas, 799_850_000n);
});

test("evm signer preserves explicit eip1559 fees from the intent", async () => {
  const provider = buildProvider({
    feeData: {
      maxFeePerGas: 300_000_000n,
      maxPriorityFeePerGas: 150_000n,
      gasPrice: null,
    },
  });
  const signer = buildSigner(provider);

  const signed = await signer.signIntent({
    ...intent(),
    chain: "ethereum",
    tx: {
      ...intent().tx,
      maxFeePerGas: "2000000000",
      maxPriorityFeePerGas: "500000000",
    },
  }, { reserveNonce: true });
  const tx = signedTransaction(signed);

  assert.equal(tx.maxFeePerGas, 2_000_000_000n);
  assert.equal(tx.maxPriorityFeePerGas, 500_000_000n);
});

test("evm signer can reset nonce cache after dropped or timed-out broadcasts", async () => {
  const provider = buildProvider({ pendingNonce: 3 });
  const signer = buildSigner(provider);

  const first = await signer.signIntent(intent(), { reserveNonce: true });
  const second = await signer.signIntent(intent(), { reserveNonce: true });
  signer.resetNonceManagers("base");
  const retried = await signer.signIntent(intent(), { reserveNonce: true });

  assert.equal(first.metadata.nonce, 3);
  assert.equal(second.metadata.nonce, 4);
  assert.equal(retried.metadata.nonce, 3);
});

test("evm signer builds transactions through the next RPC when the active RPC fails", async () => {
  const calls = [];
  const providers = new Map([
    ["https://mainnet.base.org", buildProvider({ feeDataError: new Error("primary timeout"), calls, label: "primary" })],
    ["https://mainnet-preconf.base.org", buildProvider({ pendingNonce: 31, calls, label: "fallback" })],
  ]);
  const signer = new EvmLocalKeySigner({
    keyReader: async () => PRIVATE_KEY,
    providerFactory: (url) => providers.get(url),
  });

  const signed = await signer.signIntent(intent(), { reserveNonce: true });

  assert.equal(signed.metadata.nonce, 31);
  assert.deepEqual(calls, ["primary:fee", "fallback:fee", "fallback:balance", "fallback:nonce"]);
});

test("evm signer rejects absurd pending nonce readings and falls back to the next RPC", async () => {
  const calls = [];
  const providers = new Map([
    ["https://mainnet.base.org", buildProvider({ pendingNonce: 1_000_000_001, calls, label: "primary" })],
    ["https://mainnet-preconf.base.org", buildProvider({ pendingNonce: 193, calls, label: "fallback" })],
  ]);
  const signer = new EvmLocalKeySigner({
    keyReader: async () => PRIVATE_KEY,
    providerFactory: (url) => providers.get(url),
  });

  const signed = await signer.signIntent(intent(), { reserveNonce: true });

  assert.equal(signed.metadata.nonce, 193);
  assert.deepEqual(calls, [
    "primary:fee",
    "primary:balance",
    "primary:nonce",
    "fallback:fee",
    "fallback:balance",
    "fallback:nonce",
  ]);
});

test("evm signer retries broadcast and races receipt waits through RPC fallback urls", async () => {
  const calls = [];
  const txHash = "0x" + "b".repeat(64);
  const providers = new Map([
    ["https://mainnet.base.org", buildProvider({ broadcastError: new Error("broadcast timeout"), waitError: new Error("wait timeout"), calls, label: "primary" })],
    ["https://mainnet-preconf.base.org", buildProvider({ txHash, calls, label: "fallback" })],
  ]);
  const signer = new EvmLocalKeySigner({
    keyReader: async () => PRIVATE_KEY,
    providerFactory: (url) => providers.get(url),
  });

  const signed = await signer.signIntent(intent(), { reserveNonce: true });
  const broadcast = await signer.broadcastSignedIntent(signed);
  const receipt = await signer.waitForTransaction("base", txHash, { confirmations: 1, timeoutMs: 5_000 });

  assert.equal(broadcast.txHash, txHash);
  assert.equal(receipt.hash, txHash);
  assert.deepEqual(calls, [
    "primary:fee",
    "primary:balance",
    "primary:nonce",
    "primary:broadcast",
    "fallback:broadcast",
    "fallback:wait",
    "primary:wait",
  ]);
});

test("evm signer submits accepted raw transactions to fallback RPCs too", async () => {
  const calls = [];
  const providers = new Map([
    ["https://mainnet.base.org", buildProvider({ calls, label: "primary" })],
    ["https://mainnet-preconf.base.org", buildProvider({ calls, label: "fallback" })],
  ]);
  const signer = new EvmLocalKeySigner({
    keyReader: async () => PRIVATE_KEY,
    providerFactory: (url) => providers.get(url),
  });

  const signed = await signer.signIntent(intent(), { reserveNonce: true });
  await signer.broadcastSignedIntent(signed);

  assert.deepEqual(calls, [
    "primary:fee",
    "primary:balance",
    "primary:nonce",
    "primary:broadcast",
    "fallback:broadcast",
  ]);
});

test("evm signer treats replacement-underpriced broadcast errors as already propagated", async () => {
  const calls = [];
  const providers = new Map([
    ["https://mainnet.base.org", buildProvider({ broadcastError: new Error("replacement transaction underpriced"), calls, label: "primary" })],
    ["https://mainnet-preconf.base.org", buildProvider({ broadcastError: new Error("replacement transaction underpriced"), calls, label: "fallback" })],
  ]);
  const signer = new EvmLocalKeySigner({
    keyReader: async () => PRIVATE_KEY,
    providerFactory: (url) => providers.get(url),
  });

  const signed = await signer.signIntent(intent(), { reserveNonce: true });
  const broadcast = await signer.broadcastSignedIntent(signed);

  assert.equal(broadcast.txHash, signed.txHash);
  assert.equal(broadcast.nonce, signed.metadata.nonce);
  assert.equal(broadcast.from, signed.metadata.from);
  assert.equal(broadcast.to, signed.metadata.to);
  assert.deepEqual(calls, [
    "primary:fee",
    "primary:balance",
    "primary:nonce",
    "primary:broadcast",
    "fallback:broadcast",
  ]);
});

test("evm signer rejects transactions that cannot cover max native gas debit before reserving nonce", async () => {
  const calls = [];
  const signer = buildSigner(buildProvider({ nativeBalanceWei: 20_999_999_999_999n, calls }));

  await assert.rejects(
    () => signer.signIntent(intent(), { reserveNonce: true }),
    /insufficient_native_balance_for_gas/u,
  );

  assert.deepEqual(calls, ["provider:fee", "provider:balance"]);
});

test("evm signer rejects data-bearing tx when expected target mismatches before reserving nonce", async () => {
  const calls = [];
  const signer = buildSigner(buildProvider({ calls }));

  await assert.rejects(
    () => signer.signIntent({
      ...intent(),
      tx: {
        ...intent().tx,
        data: "0x12345678",
      },
      metadata: {
        expectedTxTo: "0x0000000000000000000000000000000000000002",
      },
    }, { reserveNonce: true }),
    /evm_tx_target_mismatch/u,
  );

  assert.deepEqual(calls, []);
});

test("evm signer rejects approval calldata that does not match approval metadata before reserving nonce", async () => {
  const calls = [];
  const signer = buildSigner(buildProvider({ calls }));

  await assert.rejects(
    () => signer.signIntent({
      ...intent(),
      intentType: "approve_exact",
      approval: {
        token: "0x0000000000000000000000000000000000000001",
        spender: "0x0000000000000000000000000000000000000003",
        amount: "123",
        mode: "per_tx",
      },
      tx: {
        ...intent().tx,
        to: "0x0000000000000000000000000000000000000001",
        data: ERC20.encodeFunctionData("approve", [
          "0x0000000000000000000000000000000000000003",
          "124",
        ]),
      },
    }, { reserveNonce: true }),
    /approval_calldata_mismatch/u,
  );

  assert.deepEqual(calls, []);
});

test("evm semantic validation rejects conflicting quoted and metadata targets", () => {
  assert.throws(
    () => validateEvmTransactionSemantics({
      ...intent(),
      tx: {
        ...intent().tx,
        data: "0x12345678",
      },
      quote: {
        txTo: "0x0000000000000000000000000000000000000002",
      },
      metadata: {
        expectedTxTo: "0x0000000000000000000000000000000000000001",
      },
    }),
    /evm_tx_expected_target_conflict/u,
  );
});
