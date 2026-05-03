import {
  SMALL_CAPITAL_CAMPAIGN_MODE,
  evidencePrimaryChainShareOverrides,
} from "./small-capital-campaign-mode.mjs";

export const CONCENTRATION_LIMITS = Object.freeze({
  maxChainSharePct: 0.50,
  chainSelectionMode: SMALL_CAPITAL_CAMPAIGN_MODE.chainSelection.mode,
  chainSharePct: evidencePrimaryChainShareOverrides(),
  maxProtocolSharePct: 0.35,
  maxOpportunitySharePct: 0.25,
  maxRewardTokenSharePct: 0.40,
  maxAssetFamilySharePct: 0.60,
});

export function concentrationLimits(overrides = {}) {
  return Object.freeze({
    ...CONCENTRATION_LIMITS,
    ...overrides,
    chainSharePct: Object.freeze({
      ...CONCENTRATION_LIMITS.chainSharePct,
      ...(overrides.chainSharePct ?? {}),
    }),
  });
}

export function evaluateConcentrationLimits({
  allocations = {},
  limits = CONCENTRATION_LIMITS,
} = {}) {
  const violations = [];

  const chainSharePct = allocations.chainSharePct ?? {};
  const protocolSharePct = allocations.protocolSharePct ?? {};
  const opportunitySharePct = allocations.opportunitySharePct ?? {};
  const rewardTokenSharePct = allocations.rewardTokenSharePct ?? {};
  const assetFamilySharePct = allocations.assetFamilySharePct ?? {};

  for (const [id, share] of Object.entries(chainSharePct)) {
    const maxChainSharePct = limits.chainSharePct?.[id] ?? limits.maxChainSharePct;
    if (share > maxChainSharePct) {
      violations.push({
        kind: "chain_concentration_exceeded",
        id,
        share,
        max: maxChainSharePct,
      });
    }
  }

  for (const [id, share] of Object.entries(protocolSharePct)) {
    if (share > limits.maxProtocolSharePct) {
      violations.push({
        kind: "protocol_concentration_exceeded",
        id,
        share,
        max: limits.maxProtocolSharePct,
      });
    }
  }

  for (const [id, share] of Object.entries(opportunitySharePct)) {
    if (share > limits.maxOpportunitySharePct) {
      violations.push({
        kind: "opportunity_concentration_exceeded",
        id,
        share,
        max: limits.maxOpportunitySharePct,
      });
    }
  }

  for (const [id, share] of Object.entries(rewardTokenSharePct)) {
    if (share > limits.maxRewardTokenSharePct) {
      violations.push({
        kind: "reward_token_concentration_exceeded",
        id,
        share,
        max: limits.maxRewardTokenSharePct,
      });
    }
  }

  for (const [id, share] of Object.entries(assetFamilySharePct)) {
    if (share > limits.maxAssetFamilySharePct) {
      violations.push({
        kind: "asset_family_concentration_exceeded",
        id,
        share,
        max: limits.maxAssetFamilySharePct,
      });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
