import assert from "node:assert/strict";
import { test } from "node:test";

import { OFFICIAL_GATEWAY_DESTINATION_CHAINS } from "../src/config/gateway-destinations.mjs";
import {
  MULTICALL3_ADDRESS,
  buildGatewayMulticall3Matrix,
  classifyContractCode,
  summarizeGatewayMulticall3Matrix,
} from "../src/evm/multicall3-availability.mjs";

test("multicall3 matrix covers official Gateway destinations exactly once", async () => {
  const report = await buildGatewayMulticall3Matrix({
    now: "2026-05-07T00:00:00.000Z",
    readCode: async ({ chain, address }) => ({
      chain,
      address,
      rpcUrl: `mock://${chain}`,
      code: "0x60016000",
    }),
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.observedAt, "2026-05-07T00:00:00.000Z");
  assert.deepEqual(report.items.map((item) => item.chain), OFFICIAL_GATEWAY_DESTINATION_CHAINS);
  assert.equal(report.items.every((item) => item.address === MULTICALL3_ADDRESS), true);
  assert.equal(report.summary.availableCount, OFFICIAL_GATEWAY_DESTINATION_CHAINS.length);
});

test("contract code classifier separates available, missing, and malformed code", () => {
  assert.equal(classifyContractCode("0x60016000"), "available");
  assert.equal(classifyContractCode("0x"), "missing");
  assert.equal(classifyContractCode(""), "missing");
  assert.equal(classifyContractCode(null), "rpc_error");
});

test("matrix records rpc errors without removing chains", async () => {
  const report = await buildGatewayMulticall3Matrix({
    chains: ["base", "bsc"],
    now: "2026-05-07T00:00:00.000Z",
    readCode: async ({ chain }) => {
      if (chain === "bsc") throw new Error("rate limited");
      return { rpcUrl: "mock://base", code: "0x60016000" };
    },
  });

  assert.deepEqual(report.items.map((item) => item.chain), ["base", "bsc"]);
  assert.equal(report.items[0].status, "available");
  assert.equal(report.items[1].status, "rpc_error");
  assert.equal(report.items[1].error, "rate limited");
  assert.deepEqual(report.summary.blockers, ["multicall3_unavailable_on_bsc"]);
});

test("summary never promotes BSC over other official Gateway chains", () => {
  const summary = summarizeGatewayMulticall3Matrix([
    { chain: "bsc", status: "available" },
    { chain: "base", status: "missing" },
    { chain: "ethereum", status: "rpc_error" },
  ]);

  assert.equal(summary.availableCount, 1);
  assert.equal(summary.missingCount, 1);
  assert.equal(summary.rpcErrorCount, 1);
  assert.deepEqual(summary.blockers, [
    "multicall3_unavailable_on_base",
    "multicall3_unavailable_on_ethereum",
  ]);
});
