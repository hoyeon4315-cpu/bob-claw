import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BSC_VENUS_READINESS_SCAFFOLD,
  buildBscVenusReadinessScaffold,
} from "../src/strategy/bsc-venus-readiness-scaffold.mjs";

test("BSC Venus scaffold is report-only and cannot enter catalog dispatch", () => {
  const scaffold = buildBscVenusReadinessScaffold({ observedAt: "2026-05-08T00:00:00.000Z" });

  assert.equal(scaffold.chain, "bsc");
  assert.equal(scaffold.protocolId, "venus");
  assert.equal(scaffold.autoExecute, false);
  assert.equal(scaffold.catalogDispatchEligible, false);
  assert.equal(scaffold.strategyLaneCreated, false);
  assert.equal(scaffold.reportOnly, true);
  assert.equal(scaffold.runtimeAuthority, "none");
});

test("BSC Venus scaffold declares proof gates without cap or timing changes", () => {
  const scaffold = buildBscVenusReadinessScaffold();

  assert.equal(scaffold.capChangeRequested, false);
  assert.equal(scaffold.paybackPolicyChangeRequested, false);
  assert.equal(scaffold.requiredProofs.includes("supported_executor_binding"), true);
  assert.equal(scaffold.requiredProofs.includes("receipt_backed_entry_exit_unwind"), true);
  assert.equal(scaffold.nextAction, "report_only_review");
});

test("exported BSC Venus scaffold stays immutable enough for deterministic readers", () => {
  assert.equal(BSC_VENUS_READINESS_SCAFFOLD.autoExecute, false);
  assert.equal(BSC_VENUS_READINESS_SCAFFOLD.catalogDispatchEligible, false);
  assert.equal(Object.isFrozen(BSC_VENUS_READINESS_SCAFFOLD), true);
});
