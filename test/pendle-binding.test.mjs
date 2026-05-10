import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerPendleBinding } from "../src/strategy/registry/plugins/yield-tokenization/pendle-binding.mjs";
import {
  getBindingRegistration,
  isSupportedBindingKind,
  supportedBindingKinds,
  resolvePlanBuilder,
  resolvePlanExecutor,
  resolveExitExecutor,
  resolveIntentType,
} from "../src/executor/protocol-binding-registry.mjs";

describe("pendle-binding registration", () => {
  it("registers pendle_yt_buy_sell_redeem binding", () => {
    registerPendleBinding();
    assert.equal(isSupportedBindingKind("pendle_yt_buy_sell_redeem"), true);
  });

  it("registration has correct metadata", () => {
    const reg = getBindingRegistration("pendle_yt_buy_sell_redeem");
    assert.equal(reg.bindingKind, "pendle_yt_buy_sell_redeem");
    assert.equal(reg.family, "pendle_yt");
    assert.equal(reg.intentType, "pendle_yt_entry");
  });

  it("resolvers return functions", () => {
    assert.equal(typeof resolvePlanBuilder("pendle_yt_buy_sell_redeem"), "function");
    assert.equal(typeof resolvePlanExecutor("pendle_yt_buy_sell_redeem"), "function");
    assert.equal(typeof resolveExitExecutor("pendle_yt_buy_sell_redeem"), "function");
    assert.equal(resolveIntentType("pendle_yt_buy_sell_redeem"), "pendle_yt_entry");
  });

  it("does not hardcode market addresses", () => {
    const reg = getBindingRegistration("pendle_yt_buy_sell_redeem");
    const json = JSON.stringify(reg);
    assert.ok(!json.includes("0x"), "binding must not hardcode addresses");
  });
});
