import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateConcentrationGuard } from "../src/executor/risk/concentration-guard.mjs";

test("concentration guard blocks projected per-chain over-allocation", () => {
  const verdict = evaluateConcentrationGuard({
    currentAllocations: {
      perStrategy: {},
      perChain: { base: 0.69 },
      perProtocol: {},
    },
    candidate: {
      strategyId: "aerodrome-cl-base",
      chainId: "base",
      addShare: 0.02,
      protocolIds: ["aerodrome"],
    },
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.action, "reject_intent");
  assert.ok(verdict.violations.some((item) => item.kind === "per_chain_share_exceeded"));
  assert.equal(verdict.details.projectedAllocations.perChain.base, 0.71);
});
