import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCaplessStrategyDiagnosis } from "../../src/cli/diagnose-capless-strategies.mjs";

const baseCaps = {
  strategyId: "ok-but-surfaced",
  autoExecute: true,
  caps: {
    perTxUsd: 5,
    perDayUsd: 25,
    perChainUsd: { base: 5 },
    maxDailyLossUsd: 10,
  },
};

test("capless diagnosis separates registry lookup mismatch from blind cap declaration", () => {
  const report = buildCaplessStrategyDiagnosis({
    auditRows: [{ strategyId: "ok-but-surfaced" }],
    currentBlockerRows: [{ strategyId: "ok-but-surfaced", code: "hard_safety_stop:capless_strategy" }],
    rawCapsById: { "ok-but-surfaced": baseCaps },
    resolvedCapsById: { "ok-but-surfaced": baseCaps },
  });

  assert.equal(report.rows[0].rootCause, "registry_lookup_mismatch");
  assert.equal(report.rows[0].recommendedAction, "fix_policy_lookup_path");
});

test("capless diagnosis detects zero or falsy cap values", () => {
  const report = buildCaplessStrategyDiagnosis({
    auditRows: [{ strategyId: "zero-cap" }],
    rawCapsById: {
      "zero-cap": {
        ...baseCaps,
        strategyId: "zero-cap",
        caps: { ...baseCaps.caps, perTxUsd: 0 },
      },
    },
    resolvedCapsById: {
      "zero-cap": {
        ...baseCaps,
        strategyId: "zero-cap",
        caps: { ...baseCaps.caps, perTxUsd: 0 },
      },
    },
  });

  assert.equal(report.rows[0].rootCause, "cap_value_zero_or_falsy");
  assert.equal(report.rows[0].recommendedAction, "declare_cap_in_committed_diff");
});

test("capless diagnosis detects missing modules, tiny-live caps, and scale clamps", () => {
  const report = buildCaplessStrategyDiagnosis({
    auditRows: [
      { strategyId: "missing" },
      { strategyId: "radar" },
      { strategyId: "scaled" },
    ],
    rawCapsById: {
      radar: baseCaps,
      scaled: { ...baseCaps, strategyId: "scaled" },
    },
    resolvedCapsById: {
      radar: baseCaps,
      scaled: {
        ...baseCaps,
        strategyId: "scaled",
        caps: { ...baseCaps.caps, perTxUsd: 0 },
      },
    },
    radarEligibleStrategyIds: new Set(["radar"]),
  });
  const byId = new Map(report.rows.map((row) => [row.strategyId, row]));

  assert.equal(byId.get("missing").rootCause, "cap_module_missing");
  assert.equal(byId.get("missing").recommendedAction, "declare_cap_in_committed_diff");
  assert.equal(byId.get("radar").rootCause, "tiny_live_per_tx_undeclared");
  assert.equal(byId.get("radar").recommendedAction, "declare_tiny_live_per_tx_usd");
  assert.equal(byId.get("scaled").rootCause, "scale_band_clamp_to_zero");
  assert.equal(byId.get("scaled").recommendedAction, "fix_policy_lookup_path");
});
