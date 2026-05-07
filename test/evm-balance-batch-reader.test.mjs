import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface } from "ethers";

import { readErc20BalancesBatch } from "../src/treasury/evm-balance-batch-reader.mjs";

const ERC20 = new Interface(["function balanceOf(address owner) view returns (uint256)"]);
const OWNER = "0x00000000000000000000000000000000000000aa";
const TOKEN_A = "0x0000000000000000000000000000000000000001";
const TOKEN_B = "0x0000000000000000000000000000000000000002";

test("reader uses multicall results when multicall is available", async () => {
  const calls = [];
  const rows = await readErc20BalancesBatch({
    owner: OWNER,
    tokens: [TOKEN_A, TOKEN_B],
    multicallAvailable: true,
    multicall3ReadImpl: async ({ calls: callRows }) => {
      calls.push(...callRows);
      return {
        results: [
          { index: 0, target: TOKEN_A, success: true, returnData: ERC20.encodeFunctionResult("balanceOf", [123n]) },
          { index: 1, target: TOKEN_B, success: false, returnData: "0x" },
        ],
      };
    },
    directBalanceOfImpl: async () => {
      throw new Error("direct fallback should not be used");
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[0].balanceRaw, "123");
  assert.equal(rows[1].status, "error");
  assert.equal(rows[1].error, "multicall_balanceOf_failed");
});

test("reader falls back to direct reads when multicall is unavailable", async () => {
  const direct = [];
  const rows = await readErc20BalancesBatch({
    owner: OWNER,
    tokens: [TOKEN_A, TOKEN_B],
    multicallAvailable: false,
    multicall3ReadImpl: async () => {
      throw new Error("multicall should not be used");
    },
    directBalanceOfImpl: async ({ token }) => {
      direct.push(token);
      return token === TOKEN_A ? 7n : 9n;
    },
  });

  assert.deepEqual(direct, [TOKEN_A, TOKEN_B]);
  assert.deepEqual(rows.map((row) => row.balanceRaw), ["7", "9"]);
  assert.deepEqual(rows.map((row) => row.source), ["direct_balanceOf", "direct_balanceOf"]);
});

test("reader returns explicit errors and never silently drops tokens", async () => {
  const rows = await readErc20BalancesBatch({
    owner: OWNER,
    tokens: [TOKEN_A, TOKEN_B],
    multicallAvailable: false,
    directBalanceOfImpl: async ({ token }) => {
      if (token === TOKEN_B) throw new Error("rpc rejected");
      return 5n;
    },
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[1].status, "error");
  assert.equal(rows[1].error, "rpc rejected");
});
