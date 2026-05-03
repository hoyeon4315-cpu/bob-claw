import { describe, it } from "node:test";
import assert from "node:assert";
import {
  SMALL_CAPITAL_CAMPAIGN_MODE,
  isSmallCapitalMode,
  effectiveAnchorBudgetUsd,
  effectiveOpportunisticBudgetUsd,
  effectiveMicroBudgetUsd,
  applyRewardHaircut,
  chainProfileFor,
  evidencePrimaryChainIds,
  evidencePrimaryChainShareOverrides,
  isEvidencePrimaryChain,
} from "../src/config/small-capital-campaign-mode.mjs";

describe("small-capital-campaign-mode config", () => {
  it("has required fields", () => {
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.enabled, true);
    assert.strictEqual(
      SMALL_CAPITAL_CAMPAIGN_MODE.executionStage,
      "aggressive_non_auto_cap_small_cap_v1",
    );
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.autoCapRaise, false);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.capitalThresholdUsd, 1_000);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.anchorTargetPct.min, 0.55);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.anchorTargetPct.max, 0.70);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.opportunisticMaxPct, 0.30);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.microMaxPct, 0.10);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.defaultBudgetsUsd.opportunisticMaxUsd, 125);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.defaultBudgetsUsd.microMaxUsd, 50);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.defaultBudgetsUsd.initialCampaignUsd, 35);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.defaultBudgetsUsd.maxCampaignUsd, 80);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.defaultBudgetsUsd.initialMicroUsd, 10);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.defaultBudgetsUsd.maxMicroUsd, 35);
  });

  it("uses evidence-led chain profiles instead of the legacy Base-first list", () => {
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.chainSelection.mode, "evidence_led_primary_chains");
    assert.strictEqual(Object.hasOwn(SMALL_CAPITAL_CAMPAIGN_MODE, "baseFirstChains"), false);

    assert.deepStrictEqual(evidencePrimaryChainIds(), ["base"]);
    assert.strictEqual(isEvidencePrimaryChain("base"), true);
    assert.strictEqual(isEvidencePrimaryChain("optimism"), false);

    const baseProfile = chainProfileFor("base");
    assert.strictEqual(baseProfile.role, "primary");
    assert.strictEqual(baseProfile.maxSharePct, 0.70);
    assert.match(baseProfile.evidenceStatus, /evidence/);
  });

  it("chain profiles exclude non-Gateway manual-bridge chains", () => {
    assert.equal(chainProfileFor("arbitrum"), null);
    assert.equal(chainProfileFor("polygon"), null);
  });

  it("allows any official chain to become primary through committed evidence profiles", () => {
    const policy = {
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

    assert.deepStrictEqual(evidencePrimaryChainIds(policy), ["optimism"]);
    assert.strictEqual(isEvidencePrimaryChain("optimism", policy), true);
    assert.deepStrictEqual(evidencePrimaryChainShareOverrides(policy), { optimism: 0.70 });
  });

  it("non-primary entry thresholds are positive", () => {
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.nonPrimaryEntry.minNetProfitUsd, 10);
    assert.strictEqual(SMALL_CAPITAL_CAMPAIGN_MODE.nonPrimaryEntry.minNetProfitPctOfPosition, 0.05);
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

  it("radarLane defines aggressive canary and cap review limits", () => {
    const lane = SMALL_CAPITAL_CAMPAIGN_MODE.radarLane;
    assert.strictEqual(lane.enabled, true);
    assert.strictEqual(lane.perCanaryUsd, 30);
    assert.strictEqual(lane.perDayUsd, 90);
    assert.strictEqual(lane.cumulativeOpenUsd, 200);
    assert.strictEqual(lane.realizedDailyLossLockUsd, 25);
    assert.deepStrictEqual(lane.capGraduationUsd, [10, 25, 50, 80, 100]);
  });

  it("canaryGraduation defines an automatic ladder within committed hard caps", () => {
    const ladder = SMALL_CAPITAL_CAMPAIGN_MODE.canaryGraduation;
    assert.strictEqual(ladder.enabled, true);
    assert.deepStrictEqual(ladder.rungsUsd, [5, 10, 25, 50, 80]);
    assert.strictEqual(ladder.maxAutoGraduatedUsd, 80);
    assert.strictEqual(ladder.ethereumMinRungUsd, 25);
    assert.strictEqual(ladder.minDistinctWindowsForFourthRung, 2);
    assert.strictEqual(ladder.realizedLossWindowMs, 24 * 60 * 60 * 1000);
    assert.strictEqual(ladder.realizedDailyLossLockUsd, 25);
    assert.strictEqual(ladder.noTxSentIsNeutral, true);
  });

  it("keeps radar and canary hard caps separate from the more aggressive ratio mix", () => {
    const lane = SMALL_CAPITAL_CAMPAIGN_MODE.radarLane;
    const ladder = SMALL_CAPITAL_CAMPAIGN_MODE.canaryGraduation;
    assert.strictEqual(lane.perCanaryUsd, 30);
    assert.strictEqual(lane.perDayUsd, 90);
    assert.strictEqual(lane.cumulativeOpenUsd, 200);
    assert.strictEqual(ladder.maxAutoGraduatedUsd, 80);
    assert.deepStrictEqual(ladder.rungsUsd, [5, 10, 25, 50, 80]);
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
    assert.strictEqual(effectiveAnchorBudgetUsd(500), 500 * 0.70);
  });

  it("effectiveOpportunisticBudgetUsd caps at default max", () => {
    assert.strictEqual(effectiveOpportunisticBudgetUsd(500), Math.min(500 * 0.30, 125));
    assert.strictEqual(effectiveOpportunisticBudgetUsd(10_000), 125);
  });

  it("effectiveMicroBudgetUsd caps at default max", () => {
    assert.strictEqual(effectiveMicroBudgetUsd(500), Math.min(500 * 0.10, 50));
    assert.strictEqual(effectiveMicroBudgetUsd(10_000), 50);
  });

  it("applyRewardHaircut reduces value correctly", () => {
    assert.strictEqual(applyRewardHaircut("stable", 100), 100);
    assert.strictEqual(applyRewardHaircut("liquidBluechip", 100), 75);
    assert.strictEqual(applyRewardHaircut("defaultRewardToken", 100), 50);
    assert.ok(Math.abs(applyRewardHaircut("preTgeOrPoints", 100) - 15) < 1e-9);
    assert.strictEqual(applyRewardHaircut("unknown", 100), 50);
  });
});
