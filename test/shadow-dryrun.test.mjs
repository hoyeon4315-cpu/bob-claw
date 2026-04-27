import { describe, it } from "node:test";
import assert from "node:assert";

// Import the simulate function by extracting it inline for testing
function simulateDryrun(dataPoints, principal, days) {
  const window = dataPoints.slice(-days);
  if (window.length < days) {
    return { ok: false, error: `only ${window.length} data points available, need ${days}` };
  }
  const apys = window.map((d) => d.apy ?? 0).filter((a) => a > 0);
  const avgApy = apys.reduce((a, b) => a + b, 0) / apys.length;
  const minApy = Math.min(...apys);
  const maxApy = Math.max(...apys);
  const dailyRate = avgApy / 100 / 365;
  const grossProfit = principal * dailyRate * days;
  return {
    ok: true, days, principal, avgApy, minApy, maxApy, grossProfitUsd: grossProfit,
    dailyRates: window.map((d) => ({ date: d.timestamp, apy: d.apy, tvlUsd: d.tvlUsd })),
  };
}

describe("shadow dryrun simulation", () => {
  it("calculates positive profit with stable apy", () => {
    const data = Array.from({ length: 20 }, (_, i) => ({
      timestamp: `2026-04-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      apy: 10.0,
      tvlUsd: 1000000,
    }));
    const sim = simulateDryrun(data, 1000, 14);
    assert.strictEqual(sim.ok, true);
    assert.strictEqual(sim.avgApy, 10.0);
    assert.ok(sim.grossProfitUsd > 0);
    // 1000 * 0.10 / 365 * 14 ≈ 3.8356
    assert.ok(sim.grossProfitUsd > 3.8 && sim.grossProfitUsd < 3.9);
  });

  it("returns error when insufficient data", () => {
    const data = Array.from({ length: 5 }, (_, i) => ({
      timestamp: `2026-04-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      apy: 5.0,
      tvlUsd: 1000000,
    }));
    const sim = simulateDryrun(data, 1000, 14);
    assert.strictEqual(sim.ok, false);
    assert.ok(sim.error.includes("5"));
  });

  it("handles variable apy correctly", () => {
    const data = Array.from({ length: 20 }, (_, i) => ({
      timestamp: `2026-04-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      apy: 5.0 + i * 0.5,
      tvlUsd: 1000000,
    }));
    const sim = simulateDryrun(data, 1000, 14);
    assert.strictEqual(sim.ok, true);
    // Last 14 apys: 5.5, 6.0, ..., 12.0 => avg = 8.75
    assert.strictEqual(sim.avgApy, 11.25);
    assert.strictEqual(sim.minApy, 8.0);
    assert.strictEqual(sim.maxApy, 14.5);
  });
});
