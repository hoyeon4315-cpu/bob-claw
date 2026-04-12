import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySimulationError, simulateTransactionCall } from "../src/evm/transaction-read.mjs";

function rpcResponse(result) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: "2.0", id: 1, result }),
  };
}

test("transaction simulation encodes eth_call payloads", async () => {
  const calls = [];
  const result = await simulateTransactionCall(
    "bob",
    {
      from: "0x000000000000000000000000000000000000dEaD",
      to: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
      data: "0x1234",
      valueWei: "1000",
    },
    {
      fetchImpl: async (url, init) => {
        calls.push(JSON.parse(init.body));
        return rpcResponse("0x123456");
      },
    },
  );

  assert.equal(result.blockTag, "latest");
  assert.equal(result.returnData, "0x123456");
  assert.equal(calls[0].method, "eth_call");
  assert.deepEqual(calls[0].params[0], {
    from: "0x000000000000000000000000000000000000dEaD",
    to: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    data: "0x1234",
    value: "0x3e8",
  });
  assert.equal(calls[0].params[1], "latest");
});

test("simulation errors are classified", () => {
  assert.equal(classifySimulationError({ message: "execution reverted" }), "execution_reverted");
  assert.equal(classifySimulationError({ message: "insufficient funds for gas" }), "insufficient_funds");
  assert.equal(classifySimulationError({ message: "Missing transaction target for simulation call" }), "missing_tx_target");
});
