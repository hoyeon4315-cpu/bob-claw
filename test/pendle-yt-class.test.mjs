import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPendleYtClassPlugin } from "../src/strategy/registry/plugins/yield-tokenization/pendle-yt-class.mjs";
import { validateStrategyClassPlugin } from "../src/strategy/strategy-class-interface.mjs";

describe("pendle-yt-class plugin", () => {
  it("classKey is pendle_yt", () => {
    const p = createPendleYtClassPlugin();
    assert.equal(p.classKey, "pendle_yt");
  });

  it("passes validateStrategyClassPlugin", () => {
    const p = createPendleYtClassPlugin();
    const v = validateStrategyClassPlugin(p);
    assert.equal(v.ok, true, `missing: ${v.missing.join(", ")}`);
  });

  it("classify adds classKey and ytExpiry", () => {
    const p = createPendleYtClassPlugin();
    const r = p.classify({
      strategyId: "pendle-yt-eth-base",
      chain: "base",
      protocol: "pendle",
      poolKey: "0x1234:yt",
      ytExpiry: "2026-12-31",
    });
    assert.equal(r.classKey, "pendle_yt");
    assert.equal(r.ytExpiry, "2026-12-31");
  });

  it("buildEntryIntent includes YT-specific fields", () => {
    const p = createPendleYtClassPlugin();
    const intent = p.buildEntryIntent(
      {
        strategyId: "pendle-yt-eth-base",
        chain: "base",
        protocol: "pendle",
        poolKey: "0x1234:yt",
        ytExpiry: "2026-12-31",
        impliedAprPct: 12.5,
      },
      { requestedUsd: 100 },
    );
    assert.equal(intent.intentType, "strategy_record_entry");
    assert.equal(intent.strategyId, "pendle-yt-eth-base");
    assert.equal(intent.ytExpiry, "2026-12-31");
    assert.equal(intent.impliedAprPct, 12.5);
    assert.equal(intent.requestedUsd, 100);
    assert.equal(intent.autoExecute, false);
  });

  it("scoreFor uses impliedAprPct and yt-specific haircut", () => {
    const p = createPendleYtClassPlugin();
    const s = p.scoreFor({
      strategyId: "pendle-yt-eth-base",
      impliedAprPct: 20,
      reward_haircut_pct: 50,
    });
    assert.equal(typeof s.score, "number");
    assert.ok(s.score > 0);
    assert.equal(s.breakdown.plugin, "pendle_yt");
    assert.equal(s.breakdown.impliedAprPct, 20);
    assert.equal(s.breakdown.rewardHaircutPct, 50);
  });

  it("expectedFailureModes includes yt_expired", () => {
    const p = createPendleYtClassPlugin();
    const modes = p.expectedFailureModes({
      rewardAccrual: { kind: "pendle_yt" },
    });
    assert.ok(modes.includes("yt_expired"));
    assert.ok(modes.includes("policy_reject"));
  });

  it("buildExitIntent references redemption", () => {
    const p = createPendleYtClassPlugin();
    const intent = p.buildExitIntent({
      strategyId: "pendle-yt-eth-base",
      chain: "base",
      protocol: "pendle",
      poolKey: "0x1234:yt",
    });
    assert.equal(intent.intentType, "strategy_record_exit");
    assert.equal(intent.redemptionType, "yt_redeem");
  });

  it("buildHealthCheck includes yt_expiry monitor", () => {
    const p = createPendleYtClassPlugin();
    const hc = p.buildHealthCheck({
      strategyId: "pendle-yt-eth-base",
      chain: "base",
      protocol: "pendle",
    });
    assert.ok(hc.checks.includes("yt_expiry"));
    assert.ok(hc.checks.includes("position_reader"));
  });
});
