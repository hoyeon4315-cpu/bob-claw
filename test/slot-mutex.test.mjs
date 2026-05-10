import assert from "node:assert/strict";
import { test } from "node:test";
import { acquireSlot, featureEnabled, clearAllSlots } from "../src/executor/portfolio-allocator/slot-mutex.mjs";

test("acquire slot returns acquired true and a release function", () => {
  clearAllSlots();
  const result = acquireSlot("slot-a");
  assert.equal(result.acquired, true);
  assert.equal(typeof result.release, "function");
  result.release();
});

test("double acquire same slot returns acquired false", () => {
  clearAllSlots();
  const first = acquireSlot("slot-b");
  assert.equal(first.acquired, true);

  const second = acquireSlot("slot-b");
  assert.equal(second.acquired, false);

  first.release();
});

test("release then re-acquire succeeds", () => {
  clearAllSlots();
  const first = acquireSlot("slot-c");
  assert.equal(first.acquired, true);
  first.release();

  const second = acquireSlot("slot-c");
  assert.equal(second.acquired, true);
  second.release();
});

test("timeout expiry auto-releases the slot", async () => {
  clearAllSlots();
  const timeoutMs = 50;
  const first = acquireSlot("slot-d", { timeoutMs });
  assert.equal(first.acquired, true);

  // Wait for timeout to expire
  await new Promise((resolve) => setTimeout(resolve, timeoutMs + 30));

  // Slot should be free now
  const second = acquireSlot("slot-d");
  assert.equal(second.acquired, true);
  second.release();
});

test("featureEnabled returns true by default", () => {
  assert.equal(featureEnabled({}), true);
  assert.equal(featureEnabled({ slotMutex: true }), true);
});

test("featureEnabled returns false when profile.slotMutex is false", () => {
  assert.equal(featureEnabled({ slotMutex: false }), false);
});
