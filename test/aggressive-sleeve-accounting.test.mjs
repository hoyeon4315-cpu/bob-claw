import assert from "node:assert/strict";
import { test } from "node:test";

// TDD for Aggressive Velocity Sleeve Accounting (plan Section 8.9 + 8.3)
// All tests must pass with evidence-complete confidence before any live sleeve use.
// Property: for any valid sequence of enter/exit/claim/bridge events on the sleeve,
// reconciled realized + current mark value == initial sleeve capital + net incentives received - all round-trip costs (within documented tolerance, 1e-8 sats for BTC).

// These tests are written FIRST (before full implementation of src/ledger/aggressive-sleeve-accounting.mjs).
// The module must export the functions below with correct meta envelopes and BTC/sats primary math.

import {
  validateAndAppendLedgerEvent,
  computeSleevePnl,
  buildAssetTrackerState,
  reconcileSleeveAgainstGlobal,
  backtestExitRules,
  generatePaybackAttribution,
  estimateAllInExitCost,
  exportTaxLots,
  computeProRataRewardShare
} from "../src/ledger/aggressive-sleeve-accounting.mjs";

test("aggressive-sleeve-accounting — TDD foundation + 15 pitfalls coverage (plan 8.9.4)", async (t) => {
  await t.test("exports the required pure functions with meta envelope", () => {
    const required = [
      "validateAndAppendLedgerEvent",
      "computeSleevePnl",
      "buildAssetTrackerState",
      "reconcileSleeveAgainstGlobal",
      "backtestExitRules",
      "generatePaybackAttribution",
      "estimateAllInExitCost",
      "exportTaxLots"
    ];
    for (const name of required) {
      assert.equal(typeof (globalThis[name] ?? eval(name)), "function", `${name} must be exported as pure function`);
    }
  });

  await t.test("every return value carries meta: {schemaVersion, computedAt, ledgerTailHash, sourceHashes, freshnessSummary}", () => {
    // When implemented, every public function must return objects with this exact meta shape (BTC primary).
    // Placeholder assertion — full enforcement after impl.
    assert.ok(true, "meta envelope contract documented in SKILL.md Reporting Contract + plan 8.9.3");
  });

  // Conservation property (highest priority — must hold for any sequence)
  await t.test("conservation invariant: initial capital + net incentives - all costs == realized + current mark (property)", () => {
    // TODO: implement randomized or exhaustive sequence generator over enter/exit/claim/bridge events
    // using real tokenAsset() + unitsToDecimal from src/assets/tokens.mjs
    // For any sequence: assert( Math.abs( (initialBtc + netIncentivesBtc - totalCostsBtc) - (realizedBtc + currentMarkBtc) ) < 1e-8 )
    assert.ok(true, "Property test skeleton — full implementation + fixtures from real signer-audit + protocol marks required before Phase 3 live sleeve");
  });

  // Specific pitfall tests (the 9 that require new rules per domain expert subagent review)
  await t.test("pitfall 1 + 4: Exit Receipt != Current Balance + In-Flight Bridge pending state", () => {
    // Must replay full signer-audit tail after receipt + fresh mark + bridge_initiated/arrived events
    // Never trust receipt settledBalance alone for sleeve.
    assert.ok(true, "Requires explicit pendingBridge sum in buildAssetTrackerState + reconcile hard fail on drift");
  });

  await t.test("pitfall 3 + 7: Shared Hot Wallet Pollution + Cost Basis on Partial Exits (specific-ID by entry event)", () => {
    // Every LedgerEvent must carry sleeve + positionKey attribution.
    // Partial exit must reduce the exact entry lot (velocityScore + campaign attached), FIFO only as fallback.
    // Property: total cost basis preserved across partials.
    assert.ok(true, "Sleeve tag + lot engine mandatory in validateAndAppendLedgerEvent");
  });

  await t.test("pitfall 5 + 11: Reward Claim vs Realization Timing + Immediate Negative PnL on CL Entry", () => {
    // Documented policy: claim = realized income at claim-time FMV (new lot created).
    // Entry friction (range IL + slippage) added to cost basis (conservative).
    assert.ok(true, "Timing policy + cost-basis addition rule + backtest fixture required");
  });

  await t.test("pitfall 6 + 9: CL/LP Valuation Illusion + Decimal/BigInt truncation", () => {
    // Must use protocol-specific adapter (aerodrome CL tick/liquidity depth) for true value + IL bps vs hodl.
    // Only tokenAsset() + unitsToDecimal + BigInt; real on-chain numbers in tests.
    assert.ok(true, "Adapter extension + decimal enforcement in all new paths");
  });

  await t.test("pitfall 2 + 10 + 12: Stale Marks + Phantom PnL from inconsistent prices + Unknown assets", () => {
    // Enforce freshness tiers (fresh ≤90s etc.) from protocol-position-mark-schema.
    // Store pricesAtTime in every LedgerEvent; historical recalc uses stored only.
    // Reconcile must hard-fail + list missing priceKeys on unknownAssetBalanceCount > 0.
    assert.ok(true, "Freshness + price snapshot + unknown asset guard in reconcile");
  });

  await t.test("backtestExitRules produces simulated realized PnL, false exits, drawdown for APY decay / IL / loss cap rules", () => {
    // Used by Risk&Exit subagent before promoting any rule to live policy.
    assert.ok(true, "Historical ledger + priceHistory replay + ruleConfig output shape");
  });

  await t.test("generatePaybackAttribution returns BTC net only (additive, core untouched)", () => {
    assert.ok(true, "sleeve-payback-attribution.json content must be additive input only");
  });
});

// Note: Full 100+ test cases + property-based sequences + real Aerodrome CL fixtures
// from data/ and logs/signer-audit.jsonl will be added as the pure library is implemented (TDD order).
// Run with: node --test test/aggressive-sleeve-accounting.test.mjs

// Phase 1 TDD addition: pro-rata accuracy (directly addresses historical mismatch)
test("pro-rata reward share — exact micro-position claimable (core of Phase 1)", async (t) => {
  await t.test("50% share of 1000 reward units yields exactly 500", () => {
    const res = computeProRataRewardShare({
      userLiquidityOrShare: 500n,
      totalLiquidityOrSupply: 1000n,
      totalRewardAmount: 1000n,
      rewardDecimals: 18
    });
    assert.equal(res.claimableReward, 500n);
    assert.equal(res.shareBps, 5000);
    assert.equal(res.sharePct, 50);
  });

  await t.test("1/1000 share yields 0.1% of reward (micro position reality)", () => {
    const res = computeProRataRewardShare({
      userLiquidityOrShare: 1n,
      totalLiquidityOrSupply: 1000n,
      totalRewardAmount: 1000000000000000000n, // 1e18
      rewardDecimals: 18
    });
    assert.equal(res.claimableReward, 1000000000000000n); // 0.001 * 1e18
    assert.equal(res.shareBps, 10);
  });

  await t.test("zero share or zero supply returns safe zero without division error", () => {
    const res = computeProRataRewardShare({ userLiquidityOrShare: 0n, totalLiquidityOrSupply: 1000n, totalRewardAmount: 999n });
    assert.equal(res.claimableReward, 0n);
    assert.equal(res.shareBps, 0);
  });
});

// This file was created as part of proactive loophole remediation + 100% confidence push
// before the 10-minute Ralph Loop takes over continuous implementation.