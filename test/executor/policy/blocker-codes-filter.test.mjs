import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLOCKER_CATEGORIES,
  BLOCKER_CODES,
  isFilterBlockerCode,
  normalizeBlocker,
  splitCandidateBlockers,
} from "../../../src/executor/policy/blocker-codes.mjs";

test("blocker registry exposes filter category for capital-mismatch exclusions", () => {
  assert.ok(BLOCKER_CATEGORIES.includes("filter"));
  assert.equal(BLOCKER_CODES["filter:same_chain_unprofitable"].category, "filter");
  assert.equal(BLOCKER_CODES["filter:min_position_blocked"].category, "filter");
  assert.equal(BLOCKER_CODES["filter:bridge_cost_greater_than_expected_net"].category, "filter");
  assert.equal(BLOCKER_CODES["filter:no_positive_cap_or_inventory_usd"].category, "filter");
  assert.equal(isFilterBlockerCode("filter:same_chain_unprofitable"), true);
  assert.equal(isFilterBlockerCode("proof_acquisition:route_quote_stale"), false);
});

test("same-chain unprofitable legacy reasons normalize as filters, not blockers", () => {
  const normalized = normalizeBlocker("same_chain_unprofitable:need_$57_on_base", {
    strategyId: "stablecoin_spread_loop",
    chain: "base",
  });
  assert.equal(normalized.code, "filter:same_chain_unprofitable");
  assert.equal(normalized.category, "filter");
  assert.equal(normalized.params.detail, "need_$57_on_base");
  assert.equal(normalized.params.strategyId, "stablecoin_spread_loop");
});

test("candidate blocker split keeps code gaps actionable and capital mismatch as filters", () => {
  const split = splitCandidateBlockers([
    "same_chain_unprofitable:need_$57_on_base",
    "inventory_missing",
    "strategy_tiny_live_cap_missing",
    "protocol_binding_not_ready",
  ], {
    candidateScopedInventory: true,
  });

  assert.deepEqual(split.blockers, [
    "strategy_tiny_live_cap_missing",
    "protocol_binding_not_ready",
  ]);
  assert.deepEqual(split.filters, [
    "same_chain_unprofitable:need_$57_on_base",
    "inventory_missing",
  ]);
  assert.deepEqual(split.filterCodes, [
    "filter:same_chain_unprofitable",
    "filter:inventory_mismatch",
  ]);
});
