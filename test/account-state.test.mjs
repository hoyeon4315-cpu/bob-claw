import assert from "node:assert/strict";
import { test } from "node:test";
import { readErc20Allowance, readErc20Balance, readNativeBalance, summarizeRequirement } from "../src/evm/account-state.mjs";

function rpcResponse(result) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: "2.0", id: 1, result }),
  };
}

test("account state readers encode ERC20 owner and spender calls", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return rpcResponse("0x64");
  };

  const balance = await readErc20Balance(
    "bob",
    "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    "0x000000000000000000000000000000000000dEaD",
    { fetchImpl },
  );
  const allowance = await readErc20Allowance(
    "bob",
    "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    "0x000000000000000000000000000000000000dEaD",
    "0x1111111111111111111111111111111111111111",
    { fetchImpl },
  );

  assert.equal(balance.balance, 100n);
  assert.equal(allowance.allowance, 100n);
  assert.equal(calls[0].method, "eth_call");
  assert.match(calls[0].params[0].data, /^0x70a08231/);
  assert.match(calls[1].params[0].data, /^0xdd62ed3e/);
});

test("native balance reader returns bigint and summarizeRequirement computes shortfall", async () => {
  const native = await readNativeBalance("bob", "0x000000000000000000000000000000000000dEaD", {
    fetchImpl: async () => rpcResponse("0xde0b6b3a7640000"),
  });
  const summary = summarizeRequirement(native.balanceWei, 2n * 10n ** 18n);

  assert.equal(native.balanceWei, 10n ** 18n);
  assert.equal(summary.ok, false);
  assert.equal(summary.shortfall, (10n ** 18n).toString());
});
