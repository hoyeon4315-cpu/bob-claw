import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPendingDispatchEntry,
  reconcilePendingDispatches,
} from "../../../src/executor/blocker-resolution/dispatch-tracker.mjs";

test("dispatch tracker only confirms success when a matching receipt or signer audit row appears", () => {
  const entry = buildPendingDispatchEntry({
    strategyId: "s1",
    code: "refill_or_inventory:chain_under_target",
    paramsKey: "abc",
    action: { intent: { strategyId: "s1", intentType: "capital_rebalance", chain: "base" } },
    observedAt: "2026-05-09T00:00:00.000Z",
  });
  const first = reconcilePendingDispatches([entry], { signerAuditRecords: [], receiptRecords: [] });
  assert.equal(first.confirmed.length, 0);
  assert.equal(first.pending.length, 1);

  const second = reconcilePendingDispatches([entry], {
    signerAuditRecords: [{ intentHash: entry.intentHash, lifecycle: { stage: "confirmed" }, txHash: "0xabc" }],
    receiptRecords: [],
  });
  assert.equal(second.confirmed.length, 1);
  assert.equal(second.pending.length, 0);
  assert.equal(second.confirmed[0].outcome, "receipt_confirmed");
});
