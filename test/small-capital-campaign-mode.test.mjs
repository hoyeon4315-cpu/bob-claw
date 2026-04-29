import { describe, it } from "node:test";
import assert from "node:assert";
import {
  SMALL_CAPITAL_CAMPAIGN_MODE,
  isSmallCapitalMode,
  effectiveAnchorBudgetUsd,
  effectiveOpportunisticBudgetUsd,
  effectiveMicroBudgetUsd,
  applyRewardHaircut,
} from "../src/config/small-capital-campaign-mode.mjs";

describe("small-capital-campaign-mode config", () => {
  it("has required fields", () => {
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.enabled, true);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.capitalThresholdUsd, 1_000);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.anchorTargetPct.min, 0.65);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.anchorTargetPct.max, 0.80);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.opportunisticMaxPct, 0.20);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.microMaxPct, 0.06);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.defaultBudgetsUsd.opportunisticMaxUsd, 80);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.defaultBudgetsUsd.microMaxUsd, 30);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.defaultBudgetsUsd.initialCampaignUsd, 25);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.defaultBudgetsUsd.maxCampaignUsd, 50);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.defaultBudgetsUsd.initialMicroUsd, 10);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.defaultBudgetsUsd.maxMicroUsd, 25);
  });

  it("baseFirstChains includes base", () => {
    assert.ok(SMALL_CAPITAL_CAMPAIGN_MODE.baseFirstChains.includes("base"));
  });

  it("baseFirstChains excludes non-Gateway manual-bridge chains", () => {
    assert.equal(SMALL_CAPITAL_CAMPAIGN_MODE.baseFirstChains.includes("arbitrum"), false);
    assert.equal(SMALL_CAPITAL_CAMPAIGN_MODE.baseFirstChains.includes("polygon"), false);
  });

  it("nonBaseEntry thresholds are positive", () => {
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.nonBaseEntry.minNetProfitUsd, 10);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.nonBaseEntry.minNetProfitPctOfPosition, 0.05);
  });

  it("reward haircuts are within [0,1]", () => {
    const h = SMALL_CAPITAL_CAMPAIGN_MODE.rewardHaircuts;
    assert.strictEqual(h.stable, 0.0);
    assert.strictEqual(h.liquidBluechip, 0.25);
    assert.strictEqual(h.defaultRewardToken, 0.50);
    assert.strictEqual(h.preTgeOrPoints, 0.85);
  });

  it("campaignEntry has sensible defaults", () => {
    const ce = SMALL_CAPITAL_CAMPAIGN_MODE.campaignEntry;
    assert.strictEqual(ce.minHoursRemaining, 24);
    assert.strictEqual(ce.realizedNetBufferUsd, 3);
    assert.strictEqual(ce.maxGasAndClaimPctOfExpectedReward, 0.20);
    assert.strictEqual(ce.aprDecayExitPct, 0.50);
    assert.strictEqual(ce.tvlDrainExitPct, 0.30);
    assert.strictEqual(ce.rewardTokenDropExitPct, 0.25);
  });

  it("microEntry has sensible defaults", () => {
    const me = SMALL_CAPITAL_CAMPAIGN_MODE.microEntry;
    assert.strictEqual(me.minSafetyScore, 70);
    assert.strictEqual(me.maxNewProtocolInitialUsd, 10);
    assert.strictEqual(me.maxNewProtocolAfterProofUsd, 25);
    assert.strictEqual(me.observationHoursBeforeScale, 48);
  });

  it("clRisk thresholds are defined", () => {
    const cl = SMALL_CAPITAL_CAMPAIGN_MODE.clRisk;
    assert.strictEqual(cl.maxEthBtcMove7dPct, 0.15);
    assert.strictEqual(cl.minTimeInRangePct24h, 0.80);
    assert.strictEqual(cl.exitWhenIlExceedsFeesHours, 24);
  });

  it("protocolConcentration limits are defined", () => {
    const pc = SMALL_CAPITAL_CAMPAIGN_MODE.protocolConcentration;
    assert.strictEqual(pc.defaultMaxPct, 0.25);
    assert.strictEqual(pc.venueMaxPctWithLiveMonitor, 0.50);
  });
});

describe("small-capital helpers", () => {
  it("isSmallCapitalMode returns true below threshold", () => {
    assert.strictEqual(isSmallCapitalMode(500), true);
    assert.strictEqual(isSmallCapitalMode(999), true);
    assert.strictEqual(isSmallCapitalMode(1000), false);
    assert.strictEqual(isSmallCapitalMode(2000), false);
  });

  it("effectiveAnchorBudgetUsd uses max anchor pct", () => {
    assert.strictEqual(effectiveAnchorBudgetUsd(500), 500 * 0.80);
  });

  it("effectiveOpportunisticBudgetUsd caps at default max", () => {
    assert.strictEqual(effectiveOpportunisticBudgetUsd(500), Math.min(500 * 0.20, 80));
    assert.strictEqual(effectiveOpportunisticBudgetUsd(10_000), 80);
  });

  it("effectiveMicroBudgetUsd caps at default max", () => {
    assert.strictEqual(effectiveMicroBudgetUsd(500), Math.min(500 * 0.06, 30));
    assert.strictEqual(effectiveMicroBudgetUsd(10_000), 30);
  });

  it("applyRewardHaircut reduces value correctly", () => {
    assert.strictEqual(applyRewardHaircut("stable", 100), 100);
    assert.strictEqual(applyRewardHaircut("liquidBluechip", 100), 75);
    assert.strictEqual(applyRewardHaircut("defaultRewardToken", 100), 50);
    assert.ok(Math.abs(applyRewardHaircut("preTgeOrPoints", 100) - 15) < 1e-9);
    assert.strictEqual(applyRewardHaircut("unknown", 100), 50);
  });
});
