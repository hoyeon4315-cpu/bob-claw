import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { evaluateGasBootstrap, applyBootstrapResult } from "../src/executor/bootstrap/gas-bootstrap.mjs";

describe("gas-bootstrap", () => {
  const hopCatalog = [
    { from: { chain: "base", asset: "ETH" }, to: { chain: "base", asset: "ETH" }, kind: "gas_topup", estimatedFeeBps: 5, estimatedCostWei: "100000000000000" },
    { from: { chain: "bob", asset: "ETH" }, to: { chain: "base", asset: "ETH" }, kind: "gas_topup", estimatedFeeBps: 10, estimatedCostWei: "200000000000000" },
  ];

  test("gas sufficient → ready", () => {
    const r = evaluateGasBootstrap({
      intent: { chain: "base", amountUsd: 100 },
      gasFloats: { base: { actualWei: "5000000000000000000", targetWei: "1000000000000000000" } },
      hopCatalog,
    });
    assert.equal(r.ok, true);
    assert.equal(r.status, "ready");
    assert.equal(r.reason, "gas_sufficient");
  });

  test("gas below floor → bootstrap_required_before_execution", () => {
    const r = evaluateGasBootstrap({
      intent: { chain: "base", amountUsd: 100 },
      gasFloats: { base: { actualWei: "500000000000000", targetWei: "1000000000000000000" } },
      hopCatalog,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, "bootstrap_required_before_execution");
    assert.equal(r.reason, "gas_below_floor");
    assert.ok(r.bootstrapPlan);
    assert.equal(r.bootstrapPlan.type, "gas_topup");
    assert.equal(r.bootstrapPlan.targetChain, "base");
  });

  test("no bootstrap path → bootstrap_failed", () => {
    const r = evaluateGasBootstrap({
      intent: { chain: "sonic", amountUsd: 100 },
      gasFloats: { sonic: { actualWei: "0", targetWei: "1000000000000000000" } },
      hopCatalog,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, "bootstrap_failed");
    assert.equal(r.reason, "no_economic_gas_bootstrap_path");
    assert.equal(r.bootstrapPlan, null);
  });

  test("missing chain → bootstrap_unavailable", () => {
    const r = evaluateGasBootstrap({
      intent: { chain: null },
      gasFloats: {},
      hopCatalog,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, "bootstrap_unavailable");
    assert.equal(r.reason, "intent_chain_missing");
  });

  test("applyBootstrapResult: ready → retry original intent", () => {
    const r = applyBootstrapResult({
      bootstrapResult: { status: "ready" },
      originalIntent: { chain: "base", amountUsd: 100 },
    });
    assert.equal(r.status, "ready");
    assert.ok(r.retryIntent);
  });

  test("applyBootstrapResult: bootstrap_pending → no retry yet", () => {
    const r = applyBootstrapResult({
      bootstrapResult: { status: "bootstrap_required_before_execution" },
      originalIntent: { chain: "base", amountUsd: 100 },
    });
    assert.equal(r.status, "bootstrap_pending");
    assert.equal(r.retryIntent, null);
  });

  test("applyBootstrapResult: bootstrap success → retry original intent", () => {
    const r = applyBootstrapResult({
      bootstrapResult: { status: "bootstrap_required_before_execution" },
      originalIntent: { chain: "base", amountUsd: 100 },
      bootstrapReceipt: { ok: true },
    });
    assert.equal(r.status, "bootstrap_success");
    assert.ok(r.retryIntent);
  });

  test("applyBootstrapResult: bootstrap receipt not ok → bootstrap_failed", () => {
    const r = applyBootstrapResult({
      bootstrapResult: { status: "bootstrap_required_before_execution" },
      originalIntent: { chain: "base", amountUsd: 100 },
      bootstrapReceipt: { ok: false, reason: "insufficient_gas_on_source" },
    });
    assert.equal(r.status, "bootstrap_failed");
    assert.equal(r.failureReason, "insufficient_gas_on_source");
  });
});
