import assert from "node:assert/strict";
import test from "node:test";
import { loadOperatingCapitalUsd } from "../src/lib/operating-capital-snapshot.mjs";

test("operating capital halt warning says admission is blocked, not aggressively assumed", async () => {
  const warnings = [];
  const value = await loadOperatingCapitalUsd({
    logger: { warn: (message) => warnings.push(message) },
    reader: async () => ({
      halt: true,
      flags: ["source_missing"],
      missingSources: ["evmAutopilotUsd"],
      evmDiscrepancyPct: null,
      valueUsd: null,
    }),
  });

  assert.equal(value, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /policy will block current-capital admission/);
  assert.doesNotMatch(warnings[0], /fall back to aggressive/);
});
