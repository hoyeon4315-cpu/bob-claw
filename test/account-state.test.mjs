import assert from "node:assert/strict";
import { test } from "node:test";
import { readErc20Allowance, readErc20Balance, readErc20Metadata, readErc4626SharePreview, readNativeBalance, summarizeRequirement } from "../src/evm/account-state.mjs";

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

test("account state reader decodes ERC20 metadata from dynamic string responses", async () => {
  const calls = [];
  const encodedUsdc = "0x" +
    "0000000000000000000000000000000000000000000000000000000000000020" +
    "0000000000000000000000000000000000000000000000000000000000000004" +
    "5553444300000000000000000000000000000000000000000000000000000000";
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.method === "eth_call" ? body.params[0].data : body.method);
    if (body.params[0].data === "0x313ce567") return rpcResponse("0x06");
    if (body.params[0].data === "0x95d89b41") return rpcResponse(encodedUsdc);
    if (body.params[0].data === "0x06fdde03") return rpcResponse(encodedUsdc);
    return rpcResponse("0x");
  };

  const metadata = await readErc20Metadata("base", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", { fetchImpl });

  assert.equal(metadata.decimals, 6);
  assert.equal(metadata.symbol, "USDC");
  assert.equal(metadata.name, "USDC");
  assert.deepEqual(calls.sort(), ["0x06fdde03", "0x313ce567", "0x95d89b41"].sort());
});

test("account state reader decodes ERC20 metadata from bytes32 symbol responses", async () => {
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.params[0].data === "0x313ce567") return rpcResponse("0x12");
    return rpcResponse("0x5745544800000000000000000000000000000000000000000000000000000000");
  };

  const metadata = await readErc20Metadata("base", "0x4200000000000000000000000000000000000006", { fetchImpl });

  assert.equal(metadata.decimals, 18);
  assert.equal(metadata.symbol, "WETH");
});

test("account state reader previews ERC4626 shares into underlying assets", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.params[0].data);
    if (body.params[0].data === "0x38d52e0f") {
      return rpcResponse("0x000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    }
    assert.match(body.params[0].data, /^0x07a2d13a/u);
    return rpcResponse("0x0000000000000000000000000000000000000000000000000000000000989680");
  };

  const preview = await readErc4626SharePreview("base", "0x0000000f2eB9f69274678c76222B35eEc7588a65", 10n, { fetchImpl });

  assert.equal(preview.asset, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  assert.equal(preview.assets, 10_000_000n);
  assert.deepEqual(calls.map((call) => call.slice(0, 10)), ["0x38d52e0f", "0x07a2d13a"]);
});

test("account state readers bypass fetch for loopback RPC URLs", async () => {
  const calls = [];
  const loopbackPostImpl = async (url, payload) => {
    calls.push({ url, method: payload.method });
    return rpcResponse("0x64");
  };

  const native = await readNativeBalance("bob", "0x000000000000000000000000000000000000dEaD", {
    rpcUrl: "http://127.0.0.1:8549",
    loopbackPostImpl,
  });
  const balance = await readErc20Balance(
    "bob",
    "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    "0x000000000000000000000000000000000000dEaD",
    {
      rpcUrl: "http://127.0.0.1:8549",
      loopbackPostImpl,
    },
  );

  assert.equal(native.balanceWei, 100n);
  assert.equal(balance.balance, 100n);
  assert.deepEqual(calls.map((call) => call.method), ["eth_getBalance", "eth_call"]);
});

test("account state explicit RPC endpoints do not fall through to configured live chain RPCs", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return rpcResponse("0x64");
  };

  const native = await readNativeBalance("bob", "0x000000000000000000000000000000000000dEaD", {
    rpcUrl: "http://127.0.0.1:8549",
    fetchImpl,
  });

  assert.equal(native.balanceWei, 100n);
  assert.deepEqual(calls, ["http://127.0.0.1:8549"]);
});
