import { describe, it } from "node:test";
import assert from "node:assert";
import { isIdleWindow, SCHEDULE } from "../src/config/opportunity-scheduler.mjs";
import { isOpportunityIntegrationEnabled, OPPORTUNITY_INTEGRATION } from "../src/config/opportunity-integration.mjs";
import { buildOpportunityDashboardSlice } from "../src/executor/payback/opportunity-dashboard-slice.mjs";

describe("opportunity scheduler config", () => {
  it("has 4-hour interval", () => {
    assert.strictEqual(SCHEDULE.intervalHours, 4);
  });

  it("has two idle windows", () => {
    assert.strictEqual(SCHEDULE.idleWindowsUtc.length, 2);
  });

  it("detects idle window at 07:00 UTC", () => {
    const t = new Date(Date.UTC(2026, 3, 27, 7, 0));
    assert.strictEqual(isIdleWindow(t), true);
  });

  it("detects idle window at 21:00 UTC", () => {
    const t = new Date(Date.UTC(2026, 3, 27, 21, 0));
    assert.strictEqual(isIdleWindow(t), true);
  });

  it("returns false outside idle windows", () => {
    const t = new Date(Date.UTC(2026, 3, 27, 12, 0));
    assert.strictEqual(isIdleWindow(t), false);
  });

  it("allows 15-minute overlap after window end", () => {
    const t = new Date(Date.UTC(2026, 3, 27, 8, 10));
    assert.strictEqual(isIdleWindow(t), true);
  });

  it("returns false after overlap grace", () => {
    const t = new Date(Date.UTC(2026, 3, 27, 8, 20));
    assert.strictEqual(isIdleWindow(t), false);
  });
});

describe("opportunity integration enable flag", () => {
  it("defaults to disabled", () => {
    assert.strictEqual(OPPORTUNITY_INTEGRATION.enabled, false);
    assert.strictEqual(isOpportunityIntegrationEnabled(), false);
  });
});

describe("opportunity dashboard slice", () => {
  it("builds dormant slice with defaults", () => {
    const slice = buildOpportunityDashboardSlice({});
    assert.strictEqual(slice.opportunityCount, 0);
    assert.strictEqual(slice.topScore, null);
    assert.strictEqual(slice.roundTripSuccessRate, null);
    assert.deepStrictEqual(slice.concentrationWarnings, []);
    assert.strictEqual(slice._meta.dormant, true);
    assert.strictEqual(slice._meta.type, "opportunity-dashboard-slice");
  });

  it("carries provided values", () => {
    const slice = buildOpportunityDashboardSlice({
      opportunityCount: 3,
      topScore: 0.92,
      roundTripSuccessRate: 0.88,
      concentrationWarnings: ["chain_ethereum>0.4"],
    });
    assert.strictEqual(slice.opportunityCount, 3);
    assert.strictEqual(slice.topScore, 0.92);
    assert.strictEqual(slice.roundTripSuccessRate, 0.88);
    assert.deepStrictEqual(slice.concentrationWarnings, ["chain_ethereum>0.4"]);
  });
});
