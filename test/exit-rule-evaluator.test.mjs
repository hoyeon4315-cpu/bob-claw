import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateExitRules,
  evaluateMerklUnderperformExit,
  merklExitRules,
} from "../src/config/merkl-exit-rules.mjs";

test("merklExitRules merges overrides", () => {
  const rules = merklExitRules({ aprDecayPct: 0.40 });
  assert.equal(rules.aprDecayPct, 0.40);
  assert.equal(rules.tvlDrainPct, 0.30);
});

test("evaluateMerklUnderperformExit still works (backward compat)", () => {
  const result = evaluateMerklUnderperformExit({
    position: { entryAprPct: 10 },
    queueItem: { aprPct: 4 },
  });
  assert.ok(result.triggers.includes("realized_apr_below_entry_ratio"));
});

test("evaluateExitRules triggers apr_decay_50pct_6h", () => {
  const result = evaluateExitRules({
    position: { entryAprPct: 10 },
    current: { aprPct: 4 },
  });
  assert.ok(result.triggers.includes("apr_decay_50pct_6h"));
  assert.equal(result.metrics.aprDecayPct, 0.6);
});

test("evaluateExitRules triggers tvl_drain_30pct_4h", () => {
  const result = evaluateExitRules({
    position: { tvlUsdAtEntry: 1_000_000 },
    current: { tvlUsd: 600_000 },
  });
  assert.ok(result.triggers.includes("tvl_drain_30pct_4h"));
  assert.equal(result.metrics.tvlDrainPct, 0.4);
});

test("evaluateExitRules triggers position_drawdown_12pct", () => {
  const result = evaluateExitRules({
    position: { valueUsdAtEntry: 1000 },
    current: { valueUsd: 850 },
  });
  assert.ok(result.triggers.includes("position_drawdown_12pct"));
  assert.equal(result.metrics.positionDrawdownPct, 0.15);
});

test("evaluateExitRules triggers reward_token_drop_25pct_6h", () => {
  const result = evaluateExitRules({
    position: { rewardTokenPriceUsdAtEntry: 1.0 },
    current: { rewardTokenPriceUsd: 0.70 },
  });
  assert.ok(result.triggers.includes("reward_token_drop_25pct_6h"));
  assert.ok(Math.abs(result.metrics.rewardTokenDropPct - 0.30) < 1e-12);
});

test("evaluateExitRules triggers campaign_ends_6h_harvest", () => {
  const result = evaluateExitRules({
    current: { campaignRemainingHours: 4 },
  });
  assert.ok(result.triggers.includes("campaign_ends_6h_harvest"));
  assert.equal(result.metrics.campaignRemainingHours, 4);
});

test("evaluateExitRules triggers il_8pct_lp", () => {
  const result = evaluateExitRules({
    current: { ilPct: 0.10 },
  });
  assert.ok(result.triggers.includes("il_8pct_lp"));
  assert.equal(result.metrics.ilPct, 0.10);
});

test("evaluateExitRules triggers stable_leg_depeg_80bps", () => {
  const result = evaluateExitRules({
    current: { stableLegDepegBps: 100 },
  });
  assert.ok(result.triggers.includes("stable_leg_depeg_80bps"));
  assert.equal(result.metrics.stableLegDepegBps, 100);
});

test("evaluateExitRules triggers gas_burn_exit", () => {
  const result = evaluateExitRules({
    current: { realizedGasUsd: 30, realizedRewardUsd: 100 },
  });
  assert.ok(result.triggers.includes("gas_burn_exit"));
  assert.equal(result.metrics.gasBurnRatio, 0.30);
});

test("evaluateExitRules triggers score_decay_30pct", () => {
  const result = evaluateExitRules({
    position: { scoreAtEntry: 100 },
    current: { score: 65 },
  });
  assert.ok(result.triggers.includes("score_decay_30pct"));
  assert.equal(result.metrics.scoreDecayPct, 0.35);
});

test("evaluateExitRules returns empty triggers when healthy", () => {
  const result = evaluateExitRules({
    position: { entryAprPct: 10, valueUsdAtEntry: 1000, scoreAtEntry: 100 },
    current: {
      aprPct: 9,
      valueUsd: 990,
      tvlUsd: 1_000_000,
      score: 95,
      campaignRemainingHours: 48,
      realizedGasUsd: 5,
      realizedRewardUsd: 100,
    },
  });
  assert.equal(result.triggers.length, 0);
});

test("evaluateExitRules handles missing current gracefully", () => {
  const result = evaluateExitRules({
    position: { entryAprPct: 10 },
    current: {},
  });
  assert.equal(result.triggers.length, 0);
});
