import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { buildMoneyLoopTick } from "../src/cli/executor-money-loop.mjs";
import { createStrategyRegistry } from "../src/strategy/strategy-registry.mjs";
import { defaultStrategySourcePlugins } from "../src/strategy/registry/plugins/json-file-source.mjs";

test("money loop survives empty registry and reports exact noTxReason", async () => {
  const result = await buildMoneyLoopTick({
    now: "2026-05-10T00:00:00.000Z",
    execute: true,
    registry: {
      refresh: async () => ({ ok: true, records: [], sourceHealth: {}, errors: [], empty: true }),
    },
    runAutopilotImpl: async () => {
      throw new Error("autopilot must not run without selected action");
    },
    writeArtifacts: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.noTxReason, "empty_strategy_registry");
  assert.equal(result.blockerClass, "source");
  assert.equal(result.signerDispatch.attempted, false);
});

test("money loop dispatches only through injected deterministic autopilot after selection", async () => {
  const calls = [];
  const result = await buildMoneyLoopTick({
    now: "2026-05-10T00:00:00.000Z",
    execute: true,
    deposit: {
      status: "DEPOSIT_CONFIRMED",
      deposit: { confirmedBalanceSats: 620_000 },
      operatingCapital: { classified: true, estimatedUsd: 500 },
    },
    registry: {
      refresh: async () => ({
        ok: true,
        sourceHealth: { manual: { ok: true } },
        errors: [],
        records: [
          {
            strategyId: "slot-1",
            source: "manual",
            classKey: "yield",
            family: "stable",
            chain: "base",
            protocol: "generic",
            poolKey: "pool",
            measured_apr_pct: 10,
            reward_haircut_pct: 0,
            entry_cost_usd_per_dollar: 0.001,
            exit_cost_usd_per_dollar: 0.001,
            expected_hold_days: 30,
            il_risk_class: "low",
            audit_status: "review",
            protocol_age_days: 365,
            receipts_positive_count: 1,
            receipts_total_count: 1,
            backtest_quality: "wf_cv_1_regime",
            positionReader: { kind: "reader" },
            rewardAccrual: { kind: "none" },
            pnlAccounting: { unit: "BTC" },
          },
        ],
      }),
    },
    runAutopilotImpl: async (args) => {
      calls.push(args);
      return {
        schemaVersion: 1,
        mode: "dry_run_first",
        final: {
          status: "completed",
          summary: {
            canarySweep: { executedCount: 1, broadcastStepCount: 1 },
            payback: { status: "carry", reason: "planned_payback_below_minimum" },
          },
        },
      };
    },
    writeArtifacts: false,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].execute, true);
  assert.equal(calls[0].dryRunFirst, true);
  assert.equal(result.signerDispatch.attempted, true);
  assert.equal(result.signerDispatch.broadcast, true);
  assert.equal(result.status, "live_canary_broadcast");
});

test("Merkl native-yield records do not receive reward-token haircut and can reach policy path", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "bob-claw-money-loop-"));
  try {
    await writeFile(join(tempDir, "merkl-canary-queue.json"), JSON.stringify({
      queue: [
        {
          opportunityId: "native-yield-1",
          chain: "base",
          protocolId: "generic-vault",
          mappedStrategyId: "generic_stable_carry",
          family: "stable_treasury_carry",
          executionSurface: "stableCarry",
          validationMode: "tiny_live_canary_only",
          autoEntry: { status: "ready", autoExecute: true },
          aprPct: 12,
        },
      ],
    }));

    const registry = createStrategyRegistry({ sourcePlugins: defaultStrategySourcePlugins({ dataDir: tempDir }) });
    const envelope = await registry.refresh();
    assert.equal(envelope.records[0].reward_haircut_pct, 0);
    assert.equal(envelope.records[0].backtest_quality, "operator_override");
    assert.equal(envelope.records[0].il_risk_class, "low");

    const result = await buildMoneyLoopTick({
      now: "2026-05-10T00:00:00.000Z",
      execute: false,
      deposit: {
        status: "DEPOSIT_CONFIRMED",
        deposit: { confirmedBalanceSats: 620_000 },
        operatingCapital: { classified: true, estimatedUsd: 500 },
      },
      registry,
      writeArtifacts: false,
    });

    assert.equal(result.rotator.actions.length, 1);
    assert.equal(result.noTxReason, null);
    assert.equal(result.policyValidation.status, "policy_path_invoked");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("money loop reports actionable autopilot blocker instead of preview wrapper", async () => {
  const result = await buildMoneyLoopTick({
    now: "2026-05-10T00:00:00.000Z",
    execute: true,
    deposit: {
      status: "DEPOSIT_CONFIRMED",
      deposit: { confirmedBalanceSats: 620_000 },
      operatingCapital: { classified: true, estimatedUsd: 500 },
    },
    registry: {
      refresh: async () => ({
        ok: true,
        sourceHealth: { manual: { ok: true } },
        errors: [],
        records: [
          {
            strategyId: "slot-1",
            source: "manual",
            classKey: "yield",
            family: "stable",
            chain: "base",
            protocol: "generic",
            poolKey: "pool",
            measured_apr_pct: 12,
            reward_haircut_pct: 0,
            entry_cost_usd_per_dollar: 0,
            exit_cost_usd_per_dollar: 0,
            expected_hold_days: 30,
            il_risk_class: "low",
            audit_status: "review",
            protocol_age_days: 365,
            receipts_positive_count: 1,
            receipts_total_count: 1,
            backtest_quality: "wf_cv_1_regime",
            positionReader: { kind: "reader" },
            rewardAccrual: { kind: "none" },
            pnlAccounting: { unit: "BTC" },
          },
        ],
      }),
    },
    runAutopilotImpl: async () => ({
      mode: "dry_run_first",
      executionSkippedReason: "preview_not_full_green",
      final: {
        status: "completed_with_blockers",
        summary: {
          executionGate: { blockedReason: "preview_only" },
          merklCanary: { blockedReason: "same_chain_unprofitable:need_$57_on_base" },
        },
      },
    }),
    writeArtifacts: false,
  });

  assert.equal(result.noTxReason, "same_chain_unprofitable:need_$57_on_base");
  assert.equal(result.blockerClass, "capital");
  assert.equal(result.blocker.chain, "base");
});
