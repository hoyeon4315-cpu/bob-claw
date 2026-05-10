import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isCapitalAuditClosedForIntent,
  canMarkVerifiedCurrent,
} from "../src/executor/ingestor/capital-reconciliation.mjs";

test("isCapitalAuditClosedForIntent returns true when record exists", () => {
  const records = [
    { intentHash: "hash1", strategyId: "strategy-a" },
  ];
  assert.equal(
    isCapitalAuditClosedForIntent({ intentHash: "hash1", strategyId: "strategy-a", capitalAuditRecords: records }),
    true,
  );
});

test("isCapitalAuditClosedForIntent returns false when record missing", () => {
  const records = [
    { intentHash: "hash1", strategyId: "strategy-a" },
  ];
  assert.equal(
    isCapitalAuditClosedForIntent({ intentHash: "hash2", strategyId: "strategy-a", capitalAuditRecords: records }),
    false,
  );
});

test("canMarkVerifiedCurrent returns false when intentHash missing", () => {
  assert.equal(
    canMarkVerifiedCurrent({ intentHash: null, strategyId: "strategy-a", capitalAuditRecords: [] }),
    false,
  );
});

test("canMarkVerifiedCurrent returns true when closed", () => {
  const records = [
    { intentHash: "hash1", strategyId: "strategy-a" },
  ];
  assert.equal(
    canMarkVerifiedCurrent({ intentHash: "hash1", strategyId: "strategy-a", capitalAuditRecords: records }),
    true,
  );
});
