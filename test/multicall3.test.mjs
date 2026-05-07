import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface } from "ethers";

import {
  MULTICALL3_ABI,
  MULTICALL3_ADDRESS,
  multicall3Read,
} from "../src/lib/multicall3.mjs";

const MULTICALL3 = new Interface(MULTICALL3_ABI);

function encodeAggregate3(rows) {
  return MULTICALL3.encodeFunctionResult("aggregate3", [rows]);
}

test("multicall3Read returns an empty result for empty calls", async () => {
  const provider = {
    call: async () => {
      throw new Error("provider should not be called");
    },
  };

  const result = await multicall3Read({ provider, calls: [] });

  assert.deepEqual(result, {
    schemaVersion: 1,
    address: MULTICALL3_ADDRESS,
    batchCount: 0,
    results: [],
  });
});

test("multicall3Read batches aggregate3 calls and preserves input order", async () => {
  const sent = [];
  const provider = {
    call: async (tx, blockTag) => {
      sent.push({ tx, blockTag });
      return encodeAggregate3([
        { success: true, returnData: "0x01" },
        { success: false, returnData: "0x" },
      ]);
    },
  };

  const result = await multicall3Read({
    provider,
    batchSize: 2,
    blockTag: "latest",
    calls: [
      { target: "0x0000000000000000000000000000000000000001", callData: "0x11111111" },
      { target: "0x0000000000000000000000000000000000000002", callData: "0x22222222" },
      { target: "0x0000000000000000000000000000000000000003", callData: "0x33333333" },
      { target: "0x0000000000000000000000000000000000000004", callData: "0x44444444" },
    ],
  });

  assert.equal(sent.length, 2);
  assert.equal(sent[0].tx.to, MULTICALL3_ADDRESS);
  assert.equal(sent[0].blockTag, "latest");
  assert.deepEqual(result.results.map((row) => row.index), [0, 1, 2, 3]);
  assert.equal(result.results[0].success, true);
  assert.equal(result.results[1].success, false);
  assert.equal(result.results[2].success, true);
  assert.equal(result.results[3].success, false);
});

test("multicall3Read rejects malformed calls before touching provider", async () => {
  let touched = false;
  const provider = {
    call: async () => {
      touched = true;
      return "0x";
    },
  };

  await assert.rejects(
    () => multicall3Read({ provider, calls: [{ target: "0x123", callData: "0x" }] }),
    /multicall3_call_target_invalid/u,
  );
  assert.equal(touched, false);
});

test("multicall3Read throws a structured provider error", async () => {
  const provider = {
    call: async () => {
      throw new Error("rpc unavailable");
    },
  };

  await assert.rejects(
    () => multicall3Read({
      provider,
      calls: [{ target: "0x0000000000000000000000000000000000000001", callData: "0x11111111" }],
    }),
    /multicall3_provider_call_failed: rpc unavailable/u,
  );
});
