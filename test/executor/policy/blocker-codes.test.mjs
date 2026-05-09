import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLOCKER_CATEGORIES,
  BLOCKER_CODES,
  assertBlockerCode,
  isHardSafetyStop,
  normalizeBlocker,
  paramsHash,
} from "../../../src/executor/policy/blocker-codes.mjs";

const REQUIRED_CODES = [
  "hard_safety_stop:kill_switch_active",
  "hard_safety_stop:dev_lock_active",
  "hard_safety_stop:readiness_guard_blocked",
  "hard_safety_stop:operator_hold",
  "hard_safety_stop:paused_by_auto_kill",
  "hard_safety_stop:position_exiting",
  "hard_safety_stop:capless_strategy",
  "hard_safety_stop:hf_breach",
  "hard_safety_stop:unknown_token",
  "economic_no_go:capital_too_small",
  "economic_no_go:edge_below_variance_floor",
  "economic_no_go:cost_exceeds_payback_offramp_cap",
  "proof_acquisition:route_quote_stale",
  "proof_acquisition:gateway_route_unknown",
  "proof_acquisition:inventory_snapshot_stale",
  "proof_acquisition:rewards_unclaimed",
  "proof_acquisition:missing_yield_evidence",
  "refill_or_inventory:chain_under_target",
  "refill_or_inventory:gas_float_below_threshold",
  "refill_or_inventory:idle_dust_consolidation_due",
  "cooldown:fresh_roundtrip_proof_recorded",
  "cooldown:campaign_window_pending",
  "cooldown:harvest_period_pending",
  "executor_unbound:adapter_missing",
  "code_required:specific_recipe_required",
  "manual_review:unknown_blocker_code",
  "payback_lifecycle:payback_settlement_pending",
  "payback_lifecycle:profit_attribution_gap",
];

test("blocker registry includes required unique codes with known categories", () => {
  const keys = Object.keys(BLOCKER_CODES);
  assert.equal(new Set(keys).size, keys.length);
  for (const code of REQUIRED_CODES) {
    assert.ok(BLOCKER_CODES[code], `missing ${code}`);
    assert.ok(BLOCKER_CATEGORIES.includes(BLOCKER_CODES[code].category));
    assert.equal(BLOCKER_CODES[code].category, code.split(":")[0]);
  }
});

test("normalizeBlocker maps legacy text and forbidden names to stable codes", () => {
  assert.equal(normalizeBlocker("same_chain_unprofitable:need_$5_on_base").code, "economic_no_go:edge_below_variance_floor");
  assert.equal(normalizeBlocker("missing_yield_evidence").code, "proof_acquisition:missing_yield_evidence");
  assert.equal(normalizeBlocker("recipe_not_proven").code, "code_required:specific_recipe_required");
  assert.equal(normalizeBlocker("refill_proof_not_proven").code, "code_required:specific_recipe_required");
  assert.equal(normalizeBlocker("route_proof_not_proven").code, "code_required:specific_recipe_required");
  assert.equal(normalizeBlocker("evidence_missing_manual_only").code, "code_required:specific_recipe_required");
  const unknown = normalizeBlocker("strange_new_blocker", { strategyId: "s1", chain: "base" });
  assert.equal(unknown.code, "manual_review:unknown_blocker_code");
  assert.equal(unknown.legacyText, "strange_new_blocker");
  assert.equal(unknown.params.strategyId, "s1");
});

test("paramsHash is stable across key reordering and assertBlockerCode validates", () => {
  assert.equal(paramsHash({ b: 2, a: { y: 1, x: 0 } }), paramsHash({ a: { x: 0, y: 1 }, b: 2 }));
  assert.equal(paramsHash({ a: 1 }).length, 16);
  assert.doesNotThrow(() => assertBlockerCode("proof_acquisition:route_quote_stale"));
  assert.throws(() => assertBlockerCode("proof_acquisition:not_real"));
  assert.equal(isHardSafetyStop("hard_safety_stop:kill_switch_active"), true);
  assert.equal(isHardSafetyStop("proof_acquisition:route_quote_stale"), false);
});
