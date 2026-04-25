import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateStageGate, STAGE_GATE_POLICY } from "../src/executor/policy/stage-gate.mjs";

const READY_INPUTS = Object.freeze({
  killSwitch: { decision: "ALLOW", blockers: [] },
  autoKill24h: { triggerCount: 0, lastArmedAt: null },
  drawdown24hUsd: -5,
  oracleSourcesReachable: 4,
  paybackSnapshot: { reserveOk: true, accumulatorPendingSats: 60_000 },
  executorHeartbeat: { ageSec: 30 },
  staleQuoteCount: 0,
});

test("policy is frozen", () => {
  assert.throws(() => {
    STAGE_GATE_POLICY.minOracleSources = 1;
  });
});

test("clean inputs return READY", () => {
  const r = evaluateStageGate(READY_INPUTS);
  assert.equal(r.decision, "READY");
  assert.equal(r.ready, true);
  assert.deepEqual(r.blockers, []);
});

test("kill switch armed blocks", () => {
  const r = evaluateStageGate({
    ...READY_INPUTS,
    killSwitch: { decision: "BLOCK" },
  });
  assert.equal(r.ready, false);
  assert.ok(r.blockers.some((b) => b.kind === "kill_switch_armed_or_missing"));
});

test("auto-kill trigger in 24h blocks", () => {
  const r = evaluateStageGate({
    ...READY_INPUTS,
    autoKill24h: { triggerCount: 1 },
  });
  assert.equal(r.ready, false);
  assert.ok(r.blockers.some((b) => b.kind === "auto_kill_armed_in_24h"));
});

test("drawdown floor blocks", () => {
  const r = evaluateStageGate({
    ...READY_INPUTS,
    drawdown24hUsd: -55,
  });
  assert.ok(r.blockers.some((b) => b.kind === "drawdown_24h_below_floor"));
});

test("oracle sources under floor blocks", () => {
  const r = evaluateStageGate({
    ...READY_INPUTS,
    oracleSourcesReachable: 3,
  });
  assert.ok(r.blockers.some((b) => b.kind === "oracle_sources_under_floor"));
});

test("payback below minimum blocks", () => {
  const r = evaluateStageGate({
    ...READY_INPUTS,
    paybackSnapshot: { reserveOk: true, accumulatorPendingSats: 100 },
  });
  assert.ok(r.blockers.some((b) => b.kind === "payback_below_minimum"));
});

test("payback reserve missing blocks", () => {
  const r = evaluateStageGate({
    ...READY_INPUTS,
    paybackSnapshot: { reserveOk: false, accumulatorPendingSats: 60_000, reason: "reserve_asset_missing" },
  });
  assert.ok(r.blockers.some((b) => b.kind === "payback_reserve_not_ok"));
});

test("stale executor heartbeat blocks", () => {
  const r = evaluateStageGate({
    ...READY_INPUTS,
    executorHeartbeat: { ageSec: 1000 },
  });
  assert.ok(r.blockers.some((b) => b.kind === "executor_heartbeat_stale"));
});

test("stale quotes block", () => {
  const r = evaluateStageGate({
    ...READY_INPUTS,
    staleQuoteCount: 2,
  });
  assert.ok(r.blockers.some((b) => b.kind === "stale_quotes_present"));
});

test("missing inputs surface as unknown blockers, not crashes", () => {
  const r = evaluateStageGate({});
  assert.equal(r.ready, false);
  const kinds = r.blockers.map((b) => b.kind);
  assert.ok(kinds.includes("kill_switch_armed_or_missing"));
  assert.ok(kinds.includes("auto_kill_slice_missing"));
  assert.ok(kinds.includes("drawdown_24h_unknown"));
  assert.ok(kinds.includes("oracle_reachability_unknown"));
  assert.ok(kinds.includes("payback_snapshot_missing"));
  assert.ok(kinds.includes("executor_heartbeat_missing"));
  assert.ok(kinds.includes("stale_quote_count_unknown"));
});

test("signals echo input snapshot", () => {
  const r = evaluateStageGate(READY_INPUTS);
  assert.equal(r.signals.killSwitchDecision, "ALLOW");
  assert.equal(r.signals.autoKillTriggerCount24h, 0);
  assert.equal(r.signals.drawdown24hUsd, -5);
  assert.equal(r.signals.oracleSourcesReachable, 4);
  assert.equal(r.signals.paybackReserveOk, true);
  assert.equal(r.signals.paybackPendingSats, 60_000);
  assert.equal(r.signals.executorHeartbeatAgeSec, 30);
  assert.equal(r.signals.staleQuoteCount, 0);
});
