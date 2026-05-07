import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewayError, classifyGatewayBlockedReason, normalizeGatewayRoutesBody } from "../src/gateway/client.mjs";

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
