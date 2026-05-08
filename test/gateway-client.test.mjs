import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GatewayClient,
  GatewayError,
  classifyGatewayBlockedReason,
  normalizeGatewayRoutesBody,
  parseGatewayOrder,
} from "../src/gateway/client.mjs";

test("classifyGatewayBlockedReason maps global rate limits", () => {
  const error = new GatewayError("Gateway request failed", {
    status: 429,
    body: {
      code: "GLOBAL_LIMIT_EXCEEDED",
      error: "Global rate limit exceeded",
    },
  });
  assert.equal(classifyGatewayBlockedReason(error), "gateway_global_rate_limited");
});

test("classifyGatewayBlockedReason maps zero-btc limits separately", () => {
  const error = new GatewayError("Gateway request failed", {
    status: 429,
    body: {
      code: "EXCEEDED_LIMIT",
      error: "Requested amount exceeds current limit of 0 BTC",
      details: {
        limit: "0 BTC",
      },
    },
  });
  assert.equal(classifyGatewayBlockedReason(error), "gateway_zero_btc_limit");
});

test("classifyGatewayBlockedReason keeps non-zero route limits separate", () => {
  const error = new GatewayError("Gateway request failed", {
    status: 429,
    body: {
      code: "EXCEEDED_LIMIT",
      error: "Requested amount exceeds current limit of 0.5 BTC",
      details: {
        limit: "0.5 BTC",
      },
    },
  });
  assert.equal(classifyGatewayBlockedReason(error), "gateway_route_limit_exceeded");
});

test("normalizeGatewayRoutesBody accepts array and object route responses", () => {
  assert.deepEqual(normalizeGatewayRoutesBody([{ srcChain: "bitcoin", dstChain: "base" }]), [
    { srcChain: "bitcoin", dstChain: "base" },
  ]);
  assert.deepEqual(normalizeGatewayRoutesBody({ routes: [{ srcChain: "base", dstChain: "bitcoin" }] }), [
    { srcChain: "base", dstChain: "bitcoin" },
  ]);
  assert.deepEqual(normalizeGatewayRoutesBody({ data: { routes: [{ srcChain: "bitcoin", dstChain: "bob" }] } }), [
    { srcChain: "bitcoin", dstChain: "bob" },
  ]);
  assert.deepEqual(normalizeGatewayRoutesBody({}), []);
});

test("GatewayClient getOrders calls the documented user-orders endpoint", async () => {
  const requested = [];
  const client = new GatewayClient({
    baseUrl: "https://gateway.example",
    fetchImpl: async (url) => {
      requested.push(url);
      return new Response(JSON.stringify([{ id: "order-1", status: "success" }]), { status: 200 });
    },
  });

  const result = await client.getOrders("0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb");

  assert.equal(requested[0], "https://gateway.example/v1/get-orders/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb");
  assert.deepEqual(result.body, [{ id: "order-1", status: "success" }]);
});

test("GatewayClient getOrders preserves 404 errors for callers to classify", async () => {
  const client = new GatewayClient({
    baseUrl: "https://gateway.example",
    fetchImpl: async () => new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }),
  });

  await assert.rejects(
    () => client.getOrders("0xmissing"),
    (error) => error instanceof GatewayError && error.details.status === 404,
  );
});

test("parseGatewayOrder normalizes string and nested status variants", () => {
  assert.deepEqual(parseGatewayOrder({ status: "success" }), {
    status: "success",
    bumpFeeTx: null,
    refundTx: null,
  });

  assert.deepEqual(
    parseGatewayOrder({
      status: {
        inProgress: {
          bump_fee_tx: { to: "0xbump", data: "0x01", value: "42", chain: "bob" },
          refundTx: { txid: "refund-txid", feeRate: "12", value: "1000" },
        },
      },
    }),
    {
      status: "in_progress",
      bumpFeeTx: { to: "0xbump", data: "0x01", value: "42", chain: "bob", txid: null, feeRate: null },
      refundTx: { txid: "refund-txid", feeRate: "12", value: "1000", to: null, data: null, chain: null },
    },
  );

  assert.deepEqual(parseGatewayOrder({ status: { failed: { refund_tx: { to: "0xrefund", value: "7" } } } }), {
    status: "failed",
    bumpFeeTx: null,
    refundTx: { to: "0xrefund", data: null, value: "7", chain: null, txid: null, feeRate: null },
  });
});
