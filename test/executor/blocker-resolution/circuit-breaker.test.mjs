import assert from "node:assert/strict";
import { test } from "node:test";
import {
  circuitAllowsDependency,
  recordCircuitFailure,
  recordCircuitSuccess,
} from "../../../src/executor/blocker-resolution/circuit-breaker.mjs";

test("circuit breaker opens after threshold, half-opens after timeout, and closes on success", () => {
  let state = {};
  const config = { failureThreshold: 2, halfOpenAfterMs: 1_000 };
  const now = new Date("2026-05-09T00:00:00.000Z");
  state = recordCircuitFailure(state, "gateway-api", { config, now }).state;
  assert.equal(circuitAllowsDependency(state, "gateway-api", { config, now }).allowed, true);
  state = recordCircuitFailure(state, "gateway-api", { config, now }).state;
  assert.equal(circuitAllowsDependency(state, "gateway-api", { config, now }).allowed, false);
  const later = new Date("2026-05-09T00:00:02.000Z");
  assert.equal(circuitAllowsDependency(state, "gateway-api", { config, now: later }).state, "half_open");
  state = recordCircuitSuccess(state, "gateway-api", { now: later }).state;
  assert.equal(circuitAllowsDependency(state, "gateway-api", { config, now: later }).allowed, true);
});
