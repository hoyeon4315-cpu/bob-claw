import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySendTransactionError, sendRawTransaction } from "../src/evm/transaction-submit.mjs";

function rpcResponse(result) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: "2.0", id: 1, result }),
  };
}

test("raw transaction submission falls back to the next RPC endpoint", async () => {
  const calls = [];
  const result = await sendRawTransaction(
    "bob",
    "0x1234",
    {
      rpcUrls: ["https://bad-rpc.example", "https://good-rpc.example"],
      fetchImpl: async (url, init) => {
        calls.push(url);
        if (url === "https://bad-rpc.example") {
          throw new Error("fetch failed");
        }
        const body = JSON.parse(init.body);
        assert.equal(body.method, "eth_sendRawTransaction");
        assert.deepEqual(body.params, ["0x1234"]);
        return rpcResponse("0xabc");
      },
    },
  );

  assert.equal(result.txHash, "0xabc");
  assert.equal(result.rpcUrl, "https://good-rpc.example");
  assert.equal(result.signedTxBytes, 2);
  assert.equal(calls.length, 2);
});

test("raw transaction submission rejects invalid hex", async () => {
  await assert.rejects(
    () => sendRawTransaction("bob", "1234"),
    /0x-prefixed hex string/,
  );
});

test("submission errors are classified", () => {
  assert.equal(classifySendTransactionError({ message: "already known" }), "already_known");
  assert.equal(classifySendTransactionError({ message: "nonce too low" }), "nonce_too_low");
  assert.equal(classifySendTransactionError({ message: "replacement transaction underpriced" }), "replacement_underpriced");
  assert.equal(classifySendTransactionError({ message: "invalid sender" }), "invalid_sender");
});
