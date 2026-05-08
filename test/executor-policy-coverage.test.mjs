import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildAutoKillConfig } from "../src/config/auto-kill.mjs";
import { buildPolicyCoverageReport } from "../src/executor/policy/coverage-report.mjs";
import { evaluateIntentPolicies } from "../src/executor/policy/index.mjs";

const NOW = "2026-05-09T00:00:00.000Z";

function intent(overrides = {}) {
  return {
    strategyId: "wrapper-btc-arbitrage",
    chain: "base",
    family: "evm",
    intentType: "swap",
    mode: "live",
    amountUsd: 25,
    expectedNetUsd: 10,
    observedAt: NOW,
    metadata: {},
    ...overrides,
  };
}

async function evaluate(overrides = {}) {
  return evaluateIntentPolicies({
    intent: intent(overrides.intent),
    auditRecords: overrides.auditRecords || [],
    receiptRecords: overrides.receiptRecords || [],
    activeBudgetUsd: overrides.activeBudgetUsd ?? null,
    killSwitchPath: overrides.killSwitchPath ?? null,
    riskContext: overrides.riskContext || null,
    evCostModel: overrides.evCostModel || null,
    now: NOW,
  });
}

function assertBlocks(policy, blocker, policyName = null) {
  assert.equal(policy.decision, "BLOCK");
  assert.ok(policy.blockers.includes(blocker), `expected blocker ${blocker}, got ${policy.blockers.join(",")}`);
  if (policyName) {
    const result = policy.results.find((item) => item.policy === policyName);
    assert.ok(result, `missing policy result ${policyName}`);
    assert.equal(result.decision, "BLOCK");
  }
}

test("policy coverage 1: capless strategies are rejected as policy, not runtime authority", async () => {
  const policy = await evaluate({
    intent: {
      strategyId: "missing-caps-fixture",
      chain: "base",
      amountUsd: 1,
    },
  });

  assertBlocks(policy, "strategy_caps_missing", "strategy_caps");
});

test("policy coverage 2: sizing caps enforce per-tx, per-day, and per-chain limits", async () => {
  const perTx = await evaluate({ intent: { amountUsd: 501 } });
  assertBlocks(perTx, "strategy_per_tx_cap_exceeded", "cap_check");

  const perDay = await evaluate({
    intent: { amountUsd: 20 },
    auditRecords: [
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "base",
        timestamp: NOW,
        amountUsd: 999_990,
        policyVerdict: "approved",
        lifecycle: { stage: "broadcasted" },
      },
    ],
  });
  assertBlocks(perDay, "strategy_per_day_cap_exceeded", "cap_check");

  const perChain = await evaluate({ intent: { amountUsd: 1_000_001 } });
  assertBlocks(perChain, "strategy_per_tx_cap_exceeded", "cap_check");
  assert.ok(perChain.blockers.includes("strategy_per_chain_cap_exceeded"));
});

test("policy coverage 3: minimum net profit must clear measured gas and slippage floor", async () => {
  const policy = await evaluate({
    intent: { expectedNetUsd: -0.01 },
  });

  assertBlocks(policy, "expected_net_below_receipt_cost_p90_floor", "ev_gate");
});

test("policy coverage 4: leverage health factor and liquidation buffer are enforced", async () => {
  const policy = await evaluate({
    intent: {
      strategyId: "wrapped-btc-loop-base-moonwell",
      amountUsd: 25,
      positionState: {
        currentHealthFactor: 1.2,
        currentLiquidationBufferPct: 10,
      },
    },
  });

  assertBlocks(policy, "health_factor_below_min_pre_trade", "hf_check");
  assert.ok(policy.blockers.includes("liquidation_buffer_below_min_pre_trade"));
  assert.equal(policy.requiresUnwind, true);
});

test("policy coverage 5: three consecutive broadcast failures auto-pause strategy", async () => {
  const auditRecords = [1, 2, 3].map((index) => ({
    strategyId: "wrapper-btc-arbitrage",
    chain: "base",
    intentHash: `0x${index}`,
    timestamp: `2026-05-09T00:0${index}:00.000Z`,
    policyVerdict: "errored",
    lifecycle: { stage: "reverted" },
    broadcast: { txHash: `0xdead${index}` },
  }));
  const policy = await evaluate({ auditRecords });

  assertBlocks(policy, "max_consecutive_failures_reached", "consecutive_failures");
});

test("policy coverage 6: failed gas budget blocks after 24h cost is exhausted", async () => {
  const policy = await evaluate({
    auditRecords: [
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "base",
        timestamp: "2026-05-08T23:30:00.000Z",
        amountUsd: 1,
        policyVerdict: "errored",
        realized: { actualKnownCostUsd: 3 },
      },
    ],
  });

  assertBlocks(policy, "strategy_failed_gas_budget_breached", "cap_check");
});

test("policy coverage 7: realized 24h drawdown trips the daily loss blocker", async () => {
  const policy = await evaluate({
    auditRecords: [
      {
        strategyId: "wrapper-btc-arbitrage",
        chain: "base",
        timestamp: "2026-05-09T00:00:00.000Z",
        amountUsd: 1,
        policyVerdict: "approved",
        realized: { realizedNetPnlUsd: -1_000_000 },
      },
    ],
  });

  assertBlocks(policy, "strategy_max_daily_loss_breached", "cap_check");
});

test("policy coverage 8: stale quote is rejected", async () => {
  const policy = await evaluate({
    intent: { observedAt: "2026-05-08T23:00:00.000Z" },
  });

  assertBlocks(policy, "quote_stale", "stale_quote");
});

test("policy coverage 9: unlimited approvals are rejected", async () => {
  const policy = await evaluate({
    intent: {
      intentType: "approve_exact",
      approval: {
        token: "0x0000000000000000000000000000000000000001",
        spender: "0x0000000000000000000000000000000000000002",
        amount: "max",
        isUnlimited: true,
        mode: "unlimited",
      },
    },
  });

  assertBlocks(policy, "unlimited_approval_forbidden", "approval_hygiene");
});

test("policy coverage 10: kill-switch file blocks before broadcast", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-policy-"));
  const killSwitchPath = join(root, "KILL_SWITCH");
  await writeFile(killSwitchPath, "halted\n", "utf8");

  const policy = await evaluate({ killSwitchPath });

  assertBlocks(policy, "kill_switch_present", "kill_switch");
});

test("policy coverage 11: auto-kill triggers block policy approval", async () => {
  const policy = await evaluate({
    riskContext: {
      autoKillInputs: {
        auditRecords: [
          {
            strategyId: "wrapper-btc-arbitrage",
            chain: "base",
            timestamp: "2026-05-09T00:00:00.000Z",
            realized: { netUsd: -60 },
            lifecycle: { stage: "confirmed" },
          },
        ],
        operatingCapitalUsd: 1_000,
        config: buildAutoKillConfig({
          cumulativeLoss: { thresholdUsd: 100, operatingCapitalFractionFloor: 0.05 },
        }),
      },
    },
  });

  assertBlocks(policy, "auto_kill_triggered", "auto_kill_triggers");
  assert.equal(policy.results.find((item) => item.policy === "auto_kill_triggers").triggers[0].trigger, "cumulative_loss");
});

test("policy coverage report maps all 11 AGENTS runtime safety checks", () => {
  const report = buildPolicyCoverageReport({ generatedAt: NOW });
  assert.equal(report.summary.totalChecks, 11);
  assert.equal(report.summary.enforcedByPolicy, 11);
  assert.deepEqual(
    report.checks.map((item) => item.id),
    [
      "capless_strategy_reject",
      "caps_per_tx_day_chain_loss",
      "minimum_positive_net_after_cost",
      "leverage_hf_liquidation_buffer",
      "consecutive_failure_auto_pause",
      "failed_gas_budget_guard",
      "drawdown_kill_switch",
      "stale_quote_reject",
      "unlimited_approval_reject",
      "kill_switch_file_check",
      "auto_kill_triggers",
    ],
  );
  assert.ok(report.checks.every((item) => item.runtimeAuthority === "policy_engine"));
});
