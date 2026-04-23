import assert from "node:assert/strict";
import { test } from "node:test";
import { AcrossClient, AcrossError } from "../src/bridge/across/client.mjs";

function stubResponse({ status = 200, body, contentType = "application/json" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name === "content-type" ? contentType : null) },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

test("AcrossClient.suggestedFees issues GET with expected query params", async () => {
  let capturedUrl = null;
  const fetchImpl = async (url) => {
    capturedUrl = url;
    return stubResponse({
      body: {
        totalRelayFee: { pct: "1000000000000000", total: "100" },
        outputAmount: "9900",
        timestamp: 1_714_000_000,
      },
    });
  };
  const client = new AcrossClient({ fetchImpl, baseUrl: "https://example/api" });
  const { body } = await client.suggestedFees({
    inputToken: "0xin",
    outputToken: "0xout",
    originChainId: 8453,
    destinationChainId: 10,
    amount: "10000",
    recipient: "0xre",
  });
  assert.ok(capturedUrl.startsWith("https://example/api/suggested-fees?"));
  assert.ok(capturedUrl.includes("inputToken=0xin"));
  assert.ok(capturedUrl.includes("outputToken=0xout"));
  assert.ok(capturedUrl.includes("originChainId=8453"));
  assert.ok(capturedUrl.includes("destinationChainId=10"));
  assert.ok(capturedUrl.includes("amount=10000"));
  assert.ok(capturedUrl.includes("recipient=0xre"));
  assert.equal(body.outputAmount, "9900");
});

test("AcrossClient throws AcrossError with structured details on non-2xx", async () => {
  const fetchImpl = async () =>
    stubResponse({
      status: 400,
      body: { type: "BadRequest", message: "amount too low" },
    });
  const client = new AcrossClient({ fetchImpl, baseUrl: "https://example/api" });
  await assert.rejects(
    client.suggestedFees({
      inputToken: "0x",
      outputToken: "0x",
      originChainId: 1,
      destinationChainId: 10,
      amount: "1",
    }),
    (error) => {
      assert.ok(error instanceof AcrossError);
      assert.equal(error.details.status, 400);
      assert.equal(error.details.body.type, "BadRequest");
      return true;
    },
  );
});

test("AcrossClient throws AcrossError on invalid JSON", async () => {
  const fetchImpl = async () => stubResponse({ body: "<html>oops</html>" });
  const client = new AcrossClient({ fetchImpl, baseUrl: "https://example/api" });
  await assert.rejects(
    client.suggestedFees({
      inputToken: "0x",
      outputToken: "0x",
      originChainId: 1,
      destinationChainId: 10,
      amount: "1",
    }),
    /non-JSON response/,
  );
});
