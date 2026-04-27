import { describe, it } from "node:test";
import assert from "node:assert";
import { buildDiversifiedPortfolio, evaluateRebalance } from "../src/strategy/portfolio-allocator.mjs";

describe("portfolio allocator", () => {
  it("distributes across multiple opportunities", () => {
    const opps = [
      { chain: "Base", protocol: "aerodrome", symbol: "USDC-cbBTC", pool: "p1", apy: 50, tvlUsd: 20_000_000 },
      { chain: "Ethereum", protocol: "morpho-blue", symbol: "USDC", pool: "p2", apy: 20, tvlUsd: 100_000_000 },
      { chain: "Arbitrum", protocol: "gmx-v2", symbol: "WBTC-USDC", pool: "p3", apy: 30, tvlUsd: 10_000_000 },
      { chain: "Base", protocol: "aave-v3", symbol: "USDC", pool: "p4", apy: 5, tvlUsd: 500_000_000 },
    ];
    const portfolio = buildDiversifiedPortfolio({ opportunities: opps, totalCapitalBtc: 1.0, targetOpportunityCount: 3 });
    assert.ok(portfolio.allocations.length >= 2, "should have at least 2 allocations");
    assert.ok(portfolio.totalAllocated > 0.5, "should allocate majority of capital");
    assert.ok(portfolio.weightedNetApy > 0, "should have positive weighted APY");
  });

  it("respects chain concentration limit", () => {
    const opps = [
      { chain: "Base", protocol: "aerodrome", symbol: "A", pool: "p1", apy: 20, tvlUsd: 10_000_000 },
      { chain: "Base", protocol: "aave-v3", symbol: "B", pool: "p2", apy: 21, tvlUsd: 10_000_000 },
      { chain: "Ethereum", protocol: "morpho-blue", symbol: "C", pool: "p3", apy: 22, tvlUsd: 50_000_000 },
      { chain: "Arbitrum", protocol: "gmx-v2", symbol: "D", pool: "p4", apy: 23, tvlUsd: 10_000_000 },
    ];
    const portfolio = buildDiversifiedPortfolio({ opportunities: opps, totalCapitalBtc: 1.0 });
    const baseAmount = portfolio.chainBreakdown["base"] || 0;
    assert.ok(baseAmount <= 0.41, `Base allocation ${baseAmount} should be <= 40%`);
  });

  it("respects protocol concentration limit", () => {
    const opps = [
      { chain: "Base", protocol: "morpho-blue", symbol: "A", pool: "p1", apy: 20, tvlUsd: 50_000_000 },
      { chain: "Ethereum", protocol: "morpho-blue", symbol: "B", pool: "p2", apy: 21, tvlUsd: 50_000_000 },
      { chain: "Base", protocol: "aerodrome", symbol: "C", pool: "p3", apy: 22, tvlUsd: 20_000_000 },
      { chain: "Ethereum", protocol: "uniswap-v4", symbol: "D", pool: "p4", apy: 23, tvlUsd: 30_000_000 },
    ];
    const portfolio = buildDiversifiedPortfolio({ opportunities: opps, totalCapitalBtc: 1.0 });
    const morphoAmount = portfolio.protocolBreakdown["morpho-blue"] || 0;
    assert.ok(morphoAmount <= 0.31, `Morpho allocation ${morphoAmount} should be <= 30%`);
  });

  it("skips unknown protocols", () => {
    const opps = [
      { chain: "Base", protocol: "aerodrome", symbol: "X", pool: "p1", apy: 50, tvlUsd: 20_000_000 },
      { chain: "Base", protocol: "totally-unknown-rug", symbol: "Y", pool: "p2", apy: 500, tvlUsd: 100_000 },
    ];
    const portfolio = buildDiversifiedPortfolio({ opportunities: opps, totalCapitalBtc: 1.0 });
    const hasUnknown = portfolio.allocations.some((a) => a.opportunity.protocol === "totally-unknown-rug");
    assert.strictEqual(hasUnknown, false, "should not allocate to unknown protocols");
  });

  it("keeps cash reserve", () => {
    const opps = [
      { chain: "Base", protocol: "aerodrome", symbol: "X", pool: "p1", apy: 50, tvlUsd: 20_000_000 },
    ];
    const portfolio = buildDiversifiedPortfolio({ opportunities: opps, totalCapitalBtc: 1.0 });
    // Single opportunity gets capped at 25% by kelly, rest stays cash
    assert.ok(portfolio.cash > 0, "should keep cash reserve due to kelly cap");
    assert.ok(portfolio.cash >= 0.70, "single opp kelly cap leaves at least 75% cash");
  });

  it("rebalance triggers on significant APY improvement", () => {
    const current = [
      { opportunity: { chain: "Base", protocol: "aerodrome", symbol: "X", pool: "p1", apy: 10, tvlUsd: 10_000_000 }, allocatedBtc: 0.5, expectedNetApy: 8 },
    ];
    const newOpps = [
      { chain: "Base", protocol: "aerodrome", symbol: "Y", pool: "p2", apy: 100, tvlUsd: 20_000_000 },
    ];
    const result = evaluateRebalance({ currentPortfolio: current, newOpportunities: newOpps, totalCapitalBtc: 1.0, lastRebalanceDays: 10 });
    assert.strictEqual(result.shouldRebalance, true);
    assert.ok(result.apyImprovement > 1.0);
  });

  it("rebalance blocked when improvement is small", () => {
    const current = [
      { opportunity: { chain: "Base", protocol: "aerodrome", symbol: "X", pool: "p1", apy: 10, tvlUsd: 10_000_000 }, allocatedBtc: 0.5, expectedNetApy: 8 },
    ];
    const newOpps = [
      { chain: "Base", protocol: "aerodrome", symbol: "Y", pool: "p2", apy: 11, tvlUsd: 10_000_000 },
    ];
    const result = evaluateRebalance({ currentPortfolio: current, newOpportunities: newOpps, totalCapitalBtc: 1.0, lastRebalanceDays: 10 });
    assert.strictEqual(result.shouldRebalance, false);
  });
});
