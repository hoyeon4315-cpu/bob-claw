import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyGasEstimateError, estimateGas, getGasSnapshot } from "../src/gas/rpc-gas.mjs";

function rpcResponse(result) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: "2.0", id: 1, result }),
  };
}

test("gas snapshot falls back to the next RPC endpoint", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    const body = JSON.parse(init.body);
    if (url === "https://bad-rpc.example") {
      throw new Error("fetch failed");
    }
    if (body.method === "eth_gasPrice") {
      return rpcResponse("0x3b9aca00");
    }
    return rpcResponse({ number: "0x10", baseFeePerGas: "0x1dcd6500" });
  };

  const snapshot = await getGasSnapshot(
    "bera",
    {
      nativeSymbol: "BERA",
      rpcUrls: ["https://bad-rpc.example", "https://good-rpc.example"],
      fallbackGasUnits: 260000,
    },
    { fetchImpl },
  );

  assert.equal(snapshot.rpcUrl, "https://good-rpc.example");
  assert.equal(snapshot.rpcFallbacksTried, 1);
  assert.equal(snapshot.blockNumber, 16);
  assert.equal(calls.filter((url) => url === "https://bad-rpc.example").length, 2);
});

test("gas snapshot reports all endpoint failures", async () => {
  await assert.rejects(
    () =>
      getGasSnapshot(
        "bera",
        {
          nativeSymbol: "BERA",
          rpcUrls: ["https://bad-a.example", "https://bad-b.example"],
          fallbackGasUnits: 260000,
        },
        { fetchImpl: async () => { throw new Error("fetch failed"); } },
      ),
    (error) => {
      assert.equal(error.name, "RpcFallbackError");
      assert.equal(error.attempts.length, 2);
      return true;
    },
  );
});

test("gas estimate normalizes transaction fields and reports gas units", async () => {
  const calls = [];
  const estimate = await estimateGas(
    "bob",
    {
      from: "0x000000000000000000000000000000000000dEaD",
      to: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
      data: "0x1234",
      valueWei: "1000",
    },
    {
      nativeSymbol: "ETH",
      rpcUrls: ["https://good-rpc.example"],
      fallbackGasUnits: 260000,
    },
    {
      fetchImpl: async (url, init) => {
        calls.push(JSON.parse(init.body));
        return rpcResponse("0x5208");
      },
    },
  );

  assert.equal(estimate.gasUnits, 21000);
  assert.deepEqual(calls[0].params[0], {
    from: "0x000000000000000000000000000000000000dEaD",
    to: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    data: "0x1234",
    value: "0x3e8",
  });
});

test("gas estimate errors are classified", () => {
  assert.equal(classifyGasEstimateError({ message: "insufficient funds for gas * price + value" }), "insufficient_funds");
  assert.equal(classifyGasEstimateError({ message: "execution reverted" }), "execution_reverted");
});
