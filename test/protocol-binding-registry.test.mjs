import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getBindingRegistration,
  isSupportedBindingKind,
  registerErc4626LikeBinding,
  resolveExitExecutor,
  resolveIntentType,
  resolvePlanBuilder,
  resolvePlanExecutor,
  supportedBindingKinds,
} from "../src/executor/protocol-binding-registry.mjs";

test("built-in ERC4626 bindings are supported", () => {
  assert.equal(isSupportedBindingKind("erc4626_vault_supply_withdraw"), true);
  assert.equal(isSupportedBindingKind("euler_evault_deposit_withdraw"), true);
});

test("built-in Aave binding is supported", () => {
  assert.equal(isSupportedBindingKind("aave_v3_pool_supply_withdraw"), true);
});

test("unknown binding is not supported", () => {
  assert.equal(isSupportedBindingKind("silo_deposit_withdraw"), false);
  assert.equal(isSupportedBindingKind(""), false);
  assert.equal(isSupportedBindingKind(null), false);
});

test("supportedBindingKinds returns the built-in set", () => {
  const kinds = supportedBindingKinds();
  assert.equal(kinds.size, 3);
  assert.equal(kinds.has("erc4626_vault_supply_withdraw"), true);
  assert.equal(kinds.has("euler_evault_deposit_withdraw"), true);
  assert.equal(kinds.has("aave_v3_pool_supply_withdraw"), true);
});

test("resolvePlanBuilder returns a function for known bindings", () => {
  assert.equal(typeof resolvePlanBuilder("erc4626_vault_supply_withdraw"), "function");
  assert.equal(typeof resolvePlanBuilder("euler_evault_deposit_withdraw"), "function");
  assert.equal(typeof resolvePlanBuilder("aave_v3_pool_supply_withdraw"), "function");
});

test("resolvePlanExecutor returns a function for known bindings", () => {
  assert.equal(typeof resolvePlanExecutor("erc4626_vault_supply_withdraw"), "function");
  assert.equal(typeof resolvePlanExecutor("aave_v3_pool_supply_withdraw"), "function");
});

test("resolveExitExecutor returns a function for known bindings", () => {
  assert.equal(typeof resolveExitExecutor("erc4626_vault_supply_withdraw"), "function");
  assert.equal(typeof resolveExitExecutor("aave_v3_pool_supply_withdraw"), "function");
});

test("resolveIntentType returns correct type", () => {
  assert.equal(resolveIntentType("erc4626_vault_supply_withdraw"), "erc4626_deposit");
  assert.equal(resolveIntentType("euler_evault_deposit_withdraw"), "erc4626_deposit");
  assert.equal(resolveIntentType("aave_v3_pool_supply_withdraw"), "aave_supply");
});

test("resolvers return null for unknown bindings", () => {
  assert.equal(resolvePlanBuilder("unknown"), null);
  assert.equal(resolvePlanExecutor("unknown"), null);
  assert.equal(resolveExitExecutor("unknown"), null);
  assert.equal(resolveIntentType("unknown"), null);
});

test("getBindingRegistration returns full registration", () => {
  const reg = getBindingRegistration("aave_v3_pool_supply_withdraw");
  assert.equal(reg.bindingKind, "aave_v3_pool_supply_withdraw");
  assert.equal(reg.family, "aave");
  assert.equal(reg.intentType, "aave_supply");
  assert.equal(typeof reg.planBuilder, "function");
  assert.equal(typeof reg.planExecutor, "function");
  assert.equal(typeof reg.exitExecutor, "function");
});

test("registerErc4626LikeBinding adds a new binding", () => {
  const kind = "morpho_vault_supply_withdraw";
  registerErc4626LikeBinding(kind);
  assert.equal(isSupportedBindingKind(kind), true);
  assert.equal(resolveIntentType(kind), "erc4626_deposit");
  assert.equal(typeof resolvePlanBuilder(kind), "function");
  assert.equal(typeof resolvePlanExecutor(kind), "function");
  assert.equal(typeof resolveExitExecutor(kind), "function");
});

test("registerErc4626LikeBinding with custom intentType", () => {
  const kind = "custom_vault_deposit_withdraw";
  registerErc4626LikeBinding(kind, { intentType: "custom_deposit" });
  assert.equal(resolveIntentType(kind), "custom_deposit");
});
