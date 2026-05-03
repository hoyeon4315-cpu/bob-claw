import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONCENTRATION_LIMITS,
  concentrationLimits,
  evaluateConcentrationLimits,
} from "../src/config/concentration-limits.mjs";
import {
  SMALL_CAPITAL_CAMPAIGN_MODE,
  evidencePrimaryChainShareOverrides,
} from "../src/config/small-capital-campaign-mode.mjs";

function withOptimismPrimary() {
  return {
    ...SMALL_CAPITAL_CAMPAIGN_MODE,
    chainSelection: {
      ...SMALL_CAPITAL_CAMPAIGN_MODE.chainSelection,
      chainProfiles: {
        base: { ...SMALL_CAPITAL_CAMPAIGN_MODE.chainSelection.chainProfiles.base, role: "candidate" },
        optimism: {
          role: "primary",
          maxSharePct: 0.70,
          evidenceStatus: "live_evidence_primary",
          evidenceSource: "test committed evidence",
          reviewBy: "2026-05-16",
        },
      },
    },
  };
}

test("default limits are frozen", () => {
  assert.equal(CONCENTRATION_LIMITS.maxChainSharePct, 0.50);
  assert.equal(CONCENTRATION_LIMITS.chainSharePct.base, 0.70);
  assert.equal(CONCENTRATION_LIMITS.chainSelectionMode, "evidence_led_primary_chains");
  assert.equal(CONCENTRATION_LIMITS.maxProtocolSharePct, 0.35);
  assert.equal(CONCENTRATION_LIMITS.maxOpportunitySharePct, 0.25);
  assert.equal(CONCENTRATION_LIMITS.maxRewardTokenSharePct, 0.40);
  assert.equal(CONCENTRATION_LIMITS.maxAssetFamilySharePct, 0.60);
});

test("concentrationLimits override works", () => {
  const custom = concentrationLimits({ maxChainSharePct: 0.40 });
  assert.equal(custom.maxChainSharePct, 0.40);
  assert.equal(custom.maxProtocolSharePct, 0.35);
});

test("evaluateConcentrationLimits ok when all within limits", () => {
  const result = evaluateConcentrationLimits({
    allocations: {
      chainSharePct: { base: 0.65 },
      protocolSharePct: { morpho: 0.20 },
      opportunitySharePct: { opp1: 0.15 },
      rewardTokenSharePct: { usdc: 0.30 },
      assetFamilySharePct: { stablecoin: 0.50 },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
});

test("evaluateConcentrationLimits detects chain exceedance", () => {
  const result = evaluateConcentrationLimits({
    allocations: {
      chainSharePct: { base: 0.71 },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].kind, "chain_concentration_exceeded");
  assert.equal(result.violations[0].id, "base");
});

test("evaluateConcentrationLimits keeps non-primary chains on default chain cap", () => {
  const result = evaluateConcentrationLimits({
    allocations: {
      chainSharePct: { optimism: 0.55 },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].kind, "chain_concentration_exceeded");
  assert.equal(result.violations[0].id, "optimism");
  assert.equal(result.violations[0].max, 0.50);
});

test("evaluateConcentrationLimits lets a committed alternate primary-chain profile use the primary cap", () => {
  const result = evaluateConcentrationLimits({
    allocations: {
      chainSharePct: { optimism: 0.65 },
    },
    limits: {
      ...CONCENTRATION_LIMITS,
      chainSharePct: evidencePrimaryChainShareOverrides(withOptimismPrimary()),
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
});

test("evaluateConcentrationLimits demotes Base when another chain is evidence-primary", () => {
  const result = evaluateConcentrationLimits({
    allocations: {
      chainSharePct: { base: 0.65 },
    },
    limits: {
      ...CONCENTRATION_LIMITS,
      chainSharePct: evidencePrimaryChainShareOverrides(withOptimismPrimary()),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].kind, "chain_concentration_exceeded");
  assert.equal(result.violations[0].id, "base");
  assert.equal(result.violations[0].max, 0.50);
});

test("evaluateConcentrationLimits detects protocol exceedance", () => {
  const result = evaluateConcentrationLimits({
    allocations: {
      protocolSharePct: { aave: 0.40 },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].kind, "protocol_concentration_exceeded");
});

test("evaluateConcentrationLimits detects opportunity exceedance", () => {
  const result = evaluateConcentrationLimits({
    allocations: {
      opportunitySharePct: { opp1: 0.30 },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].kind, "opportunity_concentration_exceeded");
});

test("evaluateConcentrationLimits detects reward token exceedance", () => {
  const result = evaluateConcentrationLimits({
    allocations: {
      rewardTokenSharePct: { wbtc: 0.45 },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].kind, "reward_token_concentration_exceeded");
});

test("evaluateConcentrationLimits detects asset family exceedance", () => {
  const result = evaluateConcentrationLimits({
    allocations: {
      assetFamilySharePct: { btc_wrappers: 0.65 },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].kind, "asset_family_concentration_exceeded");
});

test("evaluateConcentrationLimits accumulates multiple violations", () => {
  const result = evaluateConcentrationLimits({
    allocations: {
      chainSharePct: { base: 0.71 },
      protocolSharePct: { aave: 0.40 },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 2);
});

test("evaluateConcentrationLimits uses custom limits", () => {
  const result = evaluateConcentrationLimits({
    allocations: {
      chainSharePct: { optimism: 0.45 },
    },
    limits: concentrationLimits({ maxChainSharePct: 0.40 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].max, 0.40);
});
