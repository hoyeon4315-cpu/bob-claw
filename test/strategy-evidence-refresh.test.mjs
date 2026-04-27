import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStrategyEvidenceRefreshPlan,
  parseArgs,
} from "../src/cli/run-strategy-evidence-refresh.mjs";

test("strategy evidence refresh parseArgs reads loop and dispatch options", () => {
  const args = parseArgs([
    "--loop",
    "--continue-on-failure",
    "--intervalMs=900000",
    "--dispatch-mode=analysis",
    "--dispatch-scope=wrapped-btc-loop-base-moonwell,recursive_wrapped_btc_lending_loop",
    "--dispatch-bucket=live_ready",
    "--dispatch-command-timeout-ms=120000",
    "--promotion-lookback-days=21",
    "--prelive-refresh-limit=3",
    "--prelive-simulation-limit=7",
    "--research-stale-hours=26",
    "--research-max-experiments=42",
    "--skip-gate-self-heal",
  ]);

  assert.equal(args.loop, true);
  assert.equal(args.continueOnFailure, true);
  assert.equal(args.intervalMs, 900000);
  assert.equal(args.dispatchMode, "analysis");
  assert.equal(args.dispatchScope, "wrapped-btc-loop-base-moonwell,recursive_wrapped_btc_lending_loop");
  assert.equal(args.dispatchBucket, "live_ready");
  assert.equal(args.dispatchCommandTimeoutMs, 120000);
  assert.equal(args.promotionLookbackDays, 21);
  assert.equal(args.preliveRefreshLimit, 3);
  assert.equal(args.preliveSimulationLimit, 7);
  assert.equal(args.researchStaleHours, 26);
  assert.equal(args.researchMaxExperiments, 42);
  assert.equal(args.skipGateSelfHeal, true);
});

test("strategy evidence refresh plan wires deterministic artifact refresh commands", () => {
  const args = parseArgs([]);
  const plan = buildStrategyEvidenceRefreshPlan({
    args,
    dataDir: "/repo/data",
    orchestrationSource: "unit_test",
    orchestratorRunId: "run-123",
  });

  assert.deepEqual(plan.map((step) => step.name), [
    "gate_self_heal",
    "auto_research_refresh",
    "gas_slippage_variance",
    "lane_reclassification",
    "destination_promotion_gate",
    "strategy_dispatch",
    "prelive_evidence_campaign",
    "promotion_preview",
    "strategy_tick",
    "strategy_tick_slice",
    "status_dashboard",
  ]);
  assert.deepEqual(plan[0].args, ["--skip-dashboard"]);
  assert.equal(plan[0].devAutomation, true);
  assert.deepEqual(plan[1].args, [
    "--continue-on-failure",
    "--stale-hours=20",
    "--max-experiments=100",
  ]);
  assert.deepEqual(plan[2].args, ["--write"]);
  assert.ok(plan[5].args.includes("--execute"));
  assert.ok(plan[5].args.includes("--continue-on-failure"));
  assert.ok(plan[5].args.includes("--mode=auto"));
  assert.ok(plan[5].args.includes("--orchestrator-source=unit_test"));
  assert.ok(plan[5].args.includes("--orchestrator-run-id=run-123"));
  assert.deepEqual(plan[6].args, [
    "--execute",
    "--write",
    "--continue-on-failure",
    "--refresh-limit=1",
    "--simulation-limit=4",
  ]);
  assert.deepEqual(plan[7].args, [
    "--write=/repo/data/promotion-latest.json",
    "--quiet",
  ]);
  assert.deepEqual(plan[8].args, ["--all-strategies", "--quiet", "--allow-shadow"]);
  assert.equal(plan[8].devAutomation, true);
  assert.deepEqual(plan[9].args, ["--quiet"]);
  assert.equal(plan[9].devAutomation, false);
  assert.deepEqual(plan[10].args, ["--skip-shadow-cycle"]);
});

test("strategy evidence refresh plan omits optional steps when skip flags are set", () => {
  const args = parseArgs([
    "--skip-gate-self-heal",
    "--skip-auto-research",
    "--skip-variance",
    "--skip-lane-reclassification",
    "--skip-destination-promotion-gate",
    "--skip-strategy-dispatch",
    "--skip-prelive-evidence",
    "--skip-promotion-preview",
    "--skip-strategy-tick",
    "--skip-dashboard",
  ]);
  const plan = buildStrategyEvidenceRefreshPlan({
    args,
    dataDir: "/repo/data",
    orchestrationSource: "unit_test",
    orchestratorRunId: "run-123",
  });

  assert.deepEqual(plan, []);
});
