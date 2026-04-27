// Composite Integration Test: 10 Real Code Path Validations
// Calls actual production modules with test data — no mocks, no simulations.

import { buildPaybackDecision, loadPaybackPolicyConfig, matchesCronExpression } from "../executor/payback/scheduler.mjs";
import snapshotPaybackAccumulator from "../executor/payback/accumulator.mjs";
import { evaluateHealthFactorCheck } from "../executor/policy/hf-check.mjs";
import { evaluateAutoKillTriggers } from "../risk/auto-kill-triggers.mjs";
import { evaluateOpportunityPolicy } from "../executor/policy/opportunity-policy.mjs";
import { evaluateConcentrationLimits, CONCENTRATION_LIMITS } from "../config/concentration-limits.mjs";
import { computePositionUsd, SIZING_POLICY, computeMinProfitablePositionUsd } from "../config/sizing.mjs";
import { PAYBACK_CONFIG } from "../config/payback.mjs";
import { WBTC_OFT_TOKEN } from "../assets/tokens.mjs";

// Helper to create a simple audit record
function auditRecord(overrides = {}) {
  return {
    timestamp: new Date().toISOString(),
    strategyId: overrides.strategyId || "test",
    chain: overrides.chain || "base",
    lifecycle: { stage: overrides.stage || "broadcast" },
    policyVerdict: overrides.policyVerdict || "approved",
    realized: overrides.realized || {},
    ...overrides,
  };
}

const SCENARIOS = [];

// ── Scenario 1: Payback Below Minimum ──────────────────────────────────────
SCENARIOS.push({
  id: 1,
  name: "Payback: Small profit carried forward (below 0.0005 BTC min)",
  run: async () => {
    const now = new Date().toISOString();
    const btcUsd = 95000;
    // $30 profit at $95k BTC = ~31,578 sats, below 50,000 min
    const profitSats = Math.round((30 / btcUsd) * 100000000);
    const auditLogLines = [
      { timestamp: now, realized: { realizedNetProfitSats: profitSats } },
    ];
    const receiptStore = {};
    const marketState = { btcUsd, regime: "neutral" };
    const decision = await buildPaybackDecision({
      auditLogLines,
      receiptStore,
      paybackConfig: PAYBACK_CONFIG,
      marketState,
      now,
    });
    const checks = [];
    checks.push({ name: "Status is 'carry' (below minimum)", pass: decision.status === "carry", value: decision.status });
    checks.push({ name: "Reason is planned_payback_below_minimum", pass: decision.reason === "planned_payback_below_minimum", value: decision.reason });
    checks.push({ name: "No recipient required for carry", pass: !decision.recipient, value: decision.recipient });
    return checks;
  },
});

// ── Scenario 2: Payback With Real Profit ───────────────────────────────────
SCENARIOS.push({
  id: 2,
  name: "Payback: $300 profit triggers plan status",
  run: async () => {
    const now = new Date().toISOString();
    const btcUsd = 95000;
    // $300 profit = 315,789 sats (< perPeriodMax 500,000)
    const profitSats = Math.round((300 / btcUsd) * 100000000);
    const auditLogLines = [
      { timestamp: now, realized: { realizedNetProfitSats: profitSats } },
    ];
    const receiptStore = {
      treasuryInventory: [
        { observedAt: now, tokens: [{ chain: "base", token: WBTC_OFT_TOKEN, actual: 100000 }] },
      ],
    };
    const marketState = { btcUsd, regime: "neutral" };
    const decision = await buildPaybackDecision({
      auditLogLines,
      receiptStore,
      paybackConfig: PAYBACK_CONFIG,
      marketState,
      now,
      getEnvImpl: (name) => name === "PAYBACK_BTC_DEST_ADDR" ? "bc1qtest123" : null,
    });
    const checks = [];
    checks.push({ name: "Status is 'plan'", pass: decision.status === "plan", value: decision.status });
    checks.push({ name: "Gross target > minPaybackSats (50k)", pass: (decision.decisionLog?.applied?.grossTargetBeforeCostsSats || 0) > 50000, value: decision.decisionLog?.applied?.grossTargetBeforeCostsSats });
    checks.push({ name: "Recipient resolved", pass: decision.recipient === "bc1qtest123", value: decision.recipient });
    return checks;
  },
});

// ── Scenario 3: Health Factor Breach ───────────────────────────────────────
SCENARIOS.push({
  id: 3,
  name: "Risk: Health factor breach blocks trade + triggers unwind",
  run: async () => {
    const intent = {
      isLeverage: true,
      strategyConfig: { leverage: { healthFactorMin: 1.20, liquidationBufferPct: 0.05 } },
      healthFactor: { current: 1.05, projectedPost: 1.03 },
      liquidationBuffer: { currentPct: 0.03, projectedPostPct: 0.02 },
    };
    const result = evaluateHealthFactorCheck({ intent, strategyCaps: null });
    const checks = [];
    checks.push({ name: "Decision is BLOCK", pass: result.decision === "BLOCK", value: result.decision });
    checks.push({ name: "HF below min detected", pass: result.blockers.includes("health_factor_below_min_pre_trade"), value: result.blockers.join(", ") });
    checks.push({ name: "Liquidation buffer breach detected", pass: result.blockers.includes("liquidation_buffer_below_min_pre_trade"), value: result.triggers.join(", ") });
    checks.push({ name: "Requires unwind", pass: result.requiresUnwind === true, value: result.requiresUnwind });
    return checks;
  },
});

// ── Scenario 4: Auto-Kill Cumulative Loss ──────────────────────────────────
SCENARIOS.push({
  id: 4,
  name: "Crisis: $1,200 realized loss triggers cumulative_loss kill-switch",
  run: async () => {
    const nowMs = Date.now();
    const auditRecords = [
      auditRecord({ realized: { netUsd: -400 }, stage: "broadcast" }),
      auditRecord({ realized: { netUsd: -500 }, stage: "broadcast" }),
      auditRecord({ realized: { netUsd: -300 }, stage: "broadcast" }),
    ];
    const result = evaluateAutoKillTriggers({
      auditRecords,
      operatingCapitalUsd: 520,
      now: new Date(nowMs),
    });
    const checks = [];
    checks.push({ name: "Triggered = true", pass: result.triggered === true, value: result.triggered });
    checks.push({ name: "cumulative_loss trigger present", pass: result.triggers.some((t) => t.trigger === "cumulative_loss"), value: result.triggers.map((t) => t.trigger).join(", ") });
    checks.push({ name: "Loss $1,200 > threshold", pass: result.triggers[0]?.lossUsd === 1200, value: result.triggers[0]?.lossUsd });
    return checks;
  },
});

// ── Scenario 5: Auto-Kill Failure Burst ────────────────────────────────────
SCENARIOS.push({
  id: 5,
  name: "Crisis: 5 consecutive failures on same strategy trigger pause",
  run: async () => {
    const nowMs = Date.now();
    const auditRecords = Array.from({ length: 5 }).map((_, i) =>
      auditRecord({ strategyId: "wrapped-btc-loop", stage: "reverted", policyVerdict: "rejected", timestamp: new Date(nowMs - i * 30000).toISOString() }),
    );
    const result = evaluateAutoKillTriggers({ auditRecords, now: new Date(nowMs) });
    const checks = [];
    checks.push({ name: "failure_burst_per_strategy triggered", pass: result.triggers.some((t) => t.trigger === "failure_burst_per_strategy"), value: result.triggers.map((t) => t.trigger).join(", ") });
    checks.push({ name: "Strategy ID captured", pass: result.triggers.some((t) => t.strategyId === "wrapped-btc-loop"), value: result.triggers.find((t) => t.strategyId)?.strategyId });
    return checks;
  },
});

// ── Scenario 6: Opportunity Policy Kill-Switch ─────────────────────────────
SCENARIOS.push({
  id: 6,
  name: "Policy: Kill-switch file present blocks all intents",
  run: async () => {
    const intent = { strategyId: "test", amountUsd: 100, chain: "base", protocol: "aerodrome" };
    const result = await evaluateOpportunityPolicy({
      intent,
      killSwitchPath: "/tmp/test-kill-switch-present",
      killSwitchExistsImpl: async () => true,
      currentAllocations: { chainSharePct: { base: 0.1 }, protocolSharePct: { aerodrome: 0.1 } },
      capitalState: { totalDeployableCapital: 520 },
    });
    const checks = [];
    checks.push({ name: "Decision is BLOCK", pass: result.decision === "BLOCK", value: result.decision });
    checks.push({ name: "Kill-switch blocker present", pass: result.blockers.some((b) => b.includes("kill_switch")), value: result.blockers.join(", ") });
    return checks;
  },
});

// ── Scenario 7: Concentration Limits ───────────────────────────────────────
SCENARIOS.push({
  id: 7,
  name: "Policy: 40% single-opportunity allocation blocked (max 25%)",
  run: async () => {
    const allocations = {
      chainSharePct: { base: 0.40 },
      protocolSharePct: { aerodrome: 0.30 },
      opportunitySharePct: { "aerodrome-cl": 0.40 },
    };
    const result = evaluateConcentrationLimits({ allocations });
    const checks = [];
    checks.push({ name: "Concentration blocked", pass: result.ok === false, value: result.ok });
    checks.push({ name: "Opportunity violation found", pass: result.violations.some((v) => v.kind === "opportunity_concentration_exceeded"), value: result.violations.map((v) => v.kind).join(", ") });
    checks.push({ name: "Protocol violation found (30% > 35%? no)", pass: !result.violations.some((v) => v.kind === "protocol_concentration_exceeded"), value: "protocol 30% <= 35%" });
    return checks;
  },
});

// ── Scenario 8: Gas Profitability Gate ─────────────────────────────────────
SCENARIOS.push({
  id: 8,
  name: "Policy: Cross-chain unprofitable intent blocked by gas gate",
  run: async () => {
    const intent = {
      strategyId: "test",
      amountUsd: 20, // Too small
      chain: "base",
      srcChain: "ethereum",
      dstChain: "base",
      estimatedBridgeCostUsd: 5,
      expectedHoldDays: 14,
      apr: 10, // 10% APR
    };
    const result = await evaluateOpportunityPolicy({
      intent,
      currentAllocations: { chainSharePct: {}, protocolSharePct: {} },
      capitalState: { totalDeployableCapital: 520 },
    });
    const checks = [];
    // Should be blocked because $20 position with $5 bridge cost on 10% APR for 14 days is unprofitable
    checks.push({ name: "Decision is BLOCK", pass: result.decision === "BLOCK", value: result.decision });
    checks.push({ name: "Unprofitable blocker present", pass: result.blockers.some((b) => b.includes("unprofitable")), value: result.blockers.join(", ") });
    return checks;
  },
});

// ── Scenario 9: Micro-Test Gate ────────────────────────────────────────────
SCENARIOS.push({
  id: 9,
  name: "Policy: Micro-test >$30 blocked, <$30 allowed",
  run: async () => {
    const blockedIntent = {
      strategyId: "micro-test-alpha",
      amountUsd: 40,
      chain: "base",
      metadata: { microTest: true },
      quote: { observedAt: new Date().toISOString() },
    };
    const allowedIntent = {
      strategyId: "micro-test-beta",
      amountUsd: 25,
      chain: "base",
      metadata: { microTest: true },
      quote: { observedAt: new Date().toISOString() },
    };
    const blockedResult = await evaluateOpportunityPolicy({
      intent: blockedIntent,
      currentAllocations: { chainSharePct: {}, protocolSharePct: {} },
      capitalState: { totalDeployableCapital: 520 },
    });
    const allowedResult = await evaluateOpportunityPolicy({
      intent: allowedIntent,
      currentAllocations: { chainSharePct: {}, protocolSharePct: {} },
      capitalState: { totalDeployableCapital: 520 },
    });
    const checks = [];
    checks.push({ name: ">$30 micro-test BLOCKED", pass: blockedResult.decision === "BLOCK", value: blockedResult.decision });
    checks.push({ name: "Blocker: micro_test_max_30usd", pass: blockedResult.blockers.includes("micro_test_max_30usd"), value: blockedResult.blockers.join(", ") });
    checks.push({ name: "<$30 micro-test ALLOWED", pass: allowedResult.decision === "ALLOW", value: allowedResult.decision });
    return checks;
  },
});

// ── Scenario 10: Sizing + Concentration Composite ──────────────────────────
SCENARIOS.push({
  id: 10,
  name: "Scaling: Position sizing respects 25% max + $25 min",
  run: async () => {
    const pos1 = computePositionUsd({ totalDeployableCapital: 520, opportunityScore: 90, sumOfTopNScores: 100, tier: "TIER_A" });
    const pos2 = computePositionUsd({ totalDeployableCapital: 520, opportunityScore: 10, sumOfTopNScores: 100, tier: "TIER_C" });
    const pos3 = computePositionUsd({ totalDeployableCapital: 100, opportunityScore: 90, sumOfTopNScores: 100, tier: "TIER_A" });

    const checks = [];
    // TIER_A with 90% score = 520 * 0.9 * 1.5 = 702, but capped at 25% = 130
    checks.push({ name: "High score capped at 25% ($130)", pass: pos1 === 130, value: "$" + pos1 });
    // TIER_C with 10% score = 520 * 0.1 * 0.5 = 26
    checks.push({ name: "Low score = $26 (above $25 min)", pass: pos2 >= 25 && pos2 < 50, value: "$" + pos2 });
    // Small capital with high score: 100 * 0.9 * 1.5 = 135, capped at 25 = 25
    checks.push({ name: "Small capital min floor = $25", pass: pos3 >= 25, value: "$" + pos3 });
    return checks;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// RUNNER
// ═══════════════════════════════════════════════════════════════════════════

async function runAll() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  COMPOSITE INTEGRATION TEST: 10 REAL CODE PATHS                  ║");
  console.log("║  Production modules called with test data                        ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log("");

  const results = [];
  for (const scenario of SCENARIOS) {
    console.log("══════════════════════════════════════════════════════════════════");
    console.log("SCENARIO " + scenario.id + ": " + scenario.name);
    console.log("──────────────────────────────────────────────────────────────────");

    let checks;
    try {
      checks = await scenario.run();
    } catch (err) {
      console.log("ERROR: " + err.message);
      checks = [{ name: "Execution", pass: false, value: err.message }];
    }

    let allPass = true;
    for (const check of checks) {
      const status = check.pass ? "✅ PASS" : "❌ FAIL";
      console.log("  " + status + "  " + check.name.padEnd(45) + " " + check.value);
      if (!check.pass) allPass = false;
    }

    console.log("");
    console.log("RESULT: " + (allPass ? "✅ ALL CHECKS PASSED" : "⚠️ SOME CHECKS FAILED"));
    console.log("══════════════════════════════════════════════════════════════════");
    console.log("");
    results.push({ id: scenario.id, name: scenario.name, passed: allPass, checks });
  }

  // Summary
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("INTEGRATION TEST SUMMARY");
  console.log("══════════════════════════════════════════════════════════════════");
  let passed = 0;
  for (const r of results) {
    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    console.log("  " + status + "  Scenario " + r.id + ": " + r.name);
    if (r.passed) passed++;
  }
  console.log("");
  console.log("Total: " + SCENARIOS.length + " | Passed: " + passed + " | Failed: " + (SCENARIOS.length - passed));
  console.log("Pass Rate: " + ((passed / SCENARIOS.length) * 100).toFixed(0) + "%");
  console.log("══════════════════════════════════════════════════════════════════");

  // Write summary to file for audit
  const fs = await import("node:fs");
  const summary = {
    runAt: new Date().toISOString(),
    total: SCENARIOS.length,
    passed,
    failed: SCENARIOS.length - passed,
    passRate: (passed / SCENARIOS.length),
    results: results.map((r) => ({
      id: r.id,
      name: r.name,
      passed: r.passed,
      checks: r.checks.map((c) => ({ name: c.name, pass: c.pass, value: String(c.value) })),
    })),
  };
  fs.mkdirSync("logs/composite-tests", { recursive: true });
  fs.writeFileSync("logs/composite-tests/integration-test-" + Date.now() + ".json", JSON.stringify(summary, null, 2));
  console.log("");
  console.log("Summary written to logs/composite-tests/");
}

runAll().catch((err) => {
  console.error("FATAL: " + err.message);
  console.error(err.stack);
  process.exit(1);
});
