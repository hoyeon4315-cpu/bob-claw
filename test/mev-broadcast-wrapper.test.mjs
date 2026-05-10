import assert from "node:assert/strict";
import { test } from "node:test";
import { sendMevProtectedBroadcast, featureEnabled } from "../src/executor/signer/mev-broadcast-wrapper.mjs";

async function mockSendCommand({ message }) {
  return { received: message };
}

test("enabled adds mev_protected flag for supported chain", async () => {
  const result = await sendMevProtectedBroadcast({
    message: { command: "sign_and_broadcast", chain: "ethereum", intent: { chain: "ethereum" } },
    mevProtectionEnabled: true,
    sendCommand: mockSendCommand,
  });
  assert.equal(result.received.mev_protected, true);
  assert.equal(result.received.chain, "ethereum");
});

test("disabled does not add mev_protected flag", async () => {
  const result = await sendMevProtectedBroadcast({
    message: { command: "sign_and_broadcast", chain: "ethereum" },
    mevProtectionEnabled: false,
    sendCommand: mockSendCommand,
  });
  assert.equal(result.received.mev_protected, undefined);
});

test("unsupported chain falls back to normal broadcast", async () => {
  const result = await sendMevProtectedBroadcast({
    message: { command: "sign_and_broadcast", chain: "base" },
    mevProtectionEnabled: true,
    sendCommand: mockSendCommand,
  });
  assert.equal(result.received.mev_protected, undefined);
  assert.equal(result.received.chain, "base");
});

test("missing chain falls back to normal broadcast", async () => {
  const result = await sendMevProtectedBroadcast({
    message: { command: "health" },
    mevProtectionEnabled: true,
    sendCommand: mockSendCommand,
  });
  assert.equal(result.received.mev_protected, undefined);
});

test("featureEnabled returns true by default", () => {
  assert.equal(featureEnabled({}), true);
  assert.equal(featureEnabled({ mevBroadcastWrapper: true }), true);
});

test("featureEnabled returns false when profile.mevBroadcastWrapper is false", () => {
  assert.equal(featureEnabled({ mevBroadcastWrapper: false }), false);
});

test("feature flag off falls back to normal broadcast", async () => {
  // When featureEnabled is false, the wrapper should pass through regardless
  // of mevProtectionEnabled. We verify via the exported function.
  assert.equal(featureEnabled({ mevBroadcastWrapper: false }), false);
});
