import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  classifySimulationError,
  readTransactionByHash,
  readTransactionReceipt,
  simulateTransactionCall,
} from "../src/evm/transaction-read.mjs";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function rpcResponse(result) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: "2.0", id: 1, result }),
  };
}

test("transaction reads bypass fetch for loopback RPC URLs", async () => {
  globalThis.fetch = async () => {
    throw new Error("fetch should not be used for loopback RPC");
  };
  const calls = [];
  const loopbackPostImpl = async (url, payload) => {
    calls.push({ url, payload });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: "2.0",
        id: payload.id,
        result:
          payload.method === "eth_getTransactionReceipt"
            ? {
                transactionHash: payload.params[0],
                blockHash: "0xabc",
                blockNumber: "0x10",
                status: "0x1",
                gasUsed: "0x5208",
                effectiveGasPrice: "0x3b9aca00",
                cumulativeGasUsed: "0x5208",
                from: "0x000000000000000000000000000000000000dEaD",
                to: "0x1111111111111111111111111111111111111111",
                contractAddress: null,
              }
            : {
                hash: payload.params[0],
                blockHash: "0xabc",
                blockNumber: "0x10",
                from: "0x000000000000000000000000000000000000dEaD",
                to: "0x1111111111111111111111111111111111111111",
                nonce: "0x2",
                value: "0x0",
                gas: "0x5208",
                gasPrice: "0x3b9aca00",
                input: "0x1234",
              },
      }),
    };
  };
  const rpcUrl = "http://127.0.0.1:8548";

  const receipt = await readTransactionReceipt("base", "0xabc", { rpcUrl, loopbackPostImpl });
  const transaction = await readTransactionByHash("base", "0xabc", { rpcUrl, loopbackPostImpl });

  assert.equal(receipt.rpcUrl, rpcUrl);
  assert.equal(receipt.status, 1);
  assert.equal(receipt.gasUsed, 21000n);
  assert.equal(transaction.rpcUrl, rpcUrl);
  assert.equal(transaction.nonce, 2);
  assert.equal(transaction.input, "0x1234");
  assert.deepEqual(calls.map((item) => item.payload.method), ["eth_getTransactionReceipt", "eth_getTransactionByHash"]);
});

test("explicit transaction-read RPC endpoints do not fall through to configured live chain RPCs", async () => {
  const calls = [];
  const receipt = await readTransactionReceipt("base", "0xabc", {
    rpcUrl: "http://127.0.0.1:8548",
    fetchImpl: async (url, init) => {
      calls.push(url);
      const body = JSON.parse(init.body);
      assert.equal(body.method, "eth_getTransactionReceipt");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            transactionHash: "0xabc",
            blockHash: "0xdef",
            blockNumber: "0x1",
            status: "0x1",
            gasUsed: "0x5208",
            effectiveGasPrice: "0x1",
            cumulativeGasUsed: "0x5208",
            from: "0x000000000000000000000000000000000000dEaD",
            to: "0x1111111111111111111111111111111111111111",
            contractAddress: null,
          },
        }),
      };
    },
  });

  assert.equal(receipt.transactionHash, "0xabc");
  assert.deepEqual(calls, ["http://127.0.0.1:8548"]);
});

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
