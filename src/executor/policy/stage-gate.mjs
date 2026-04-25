// Stage-gate readiness policy.
//
// Pure function. Aggregates the five committed readiness signals that gate
// progression from stage 6 (auto kill-switch wired) to stage 7 (autonomous
// live ops). Operator-facing — does not sign or move funds. Decision is
// advisory; signer daemon still consults its own kill-switch every tick.
//
// Signals (all must clear):
//   1. killSwitch armed=false
//   2. autoKill armed=false in trailing 24h slice
//   3. drawdown24hUsd > -policy.maxDrawdownFloorUsd
//   4. oracleSourcesReachable >= policy.minOracleSources (default 4)
//   5. paybackSnapshot.reserveOk === true AND
//      paybackSnapshot.accumulatorPendingSats >= policy.minPaybackSats
//   6. executor heartbeat freshness <= policy.maxHeartbeatStaleSec
//   7. staleQuoteCount === 0
//
// Inputs are plain values — no I/O. Caller wires fixtures or live snapshots.

export const STAGE_GATE_POLICY = Object.freeze({
  minOracleSources: 4,
  maxDrawdownFloorUsd: 50,
  minPaybackSats: 50_000,
  maxHeartbeatStaleSec: 90,
  maxAutoKillTriggerCount24h: 0,
});

function pushBlocker(blockers, kind, detail) {
  blockers.push({ kind, ...(detail !== undefined ? { detail } : {}) });
}

export function evaluateStageGate({
  killSwitch = null,
  autoKill24h = null,
  drawdown24hUsd = null,
  oracleSourcesReachable = null,
  paybackSnapshot = null,
  executorHeartbeat = null,
  staleQuoteCount = null,
  policy = STAGE_GATE_POLICY,
  now = new Date().toISOString(),
} = {}) {
  const blockers = [];

  if (!killSwitch || killSwitch.decision !== "ALLOW") {
    pushBlocker(blockers, "kill_switch_armed_or_missing", killSwitch?.decision || null);
  }

  const triggerCount = autoKill24h?.triggerCount ?? null;
  if (triggerCount === null) {
    pushBlocker(blockers, "auto_kill_slice_missing");
  } else if (triggerCount > policy.maxAutoKillTriggerCount24h) {
    pushBlocker(blockers, "auto_kill_armed_in_24h", triggerCount);
  }

  if (typeof drawdown24hUsd !== "number" || !Number.isFinite(drawdown24hUsd)) {
    pushBlocker(blockers, "drawdown_24h_unknown");
  } else if (drawdown24hUsd <= -policy.maxDrawdownFloorUsd) {
    pushBlocker(blockers, "drawdown_24h_below_floor", drawdown24hUsd);
  }

  if (typeof oracleSourcesReachable !== "number") {
    pushBlocker(blockers, "oracle_reachability_unknown");
  } else if (oracleSourcesReachable < policy.minOracleSources) {
    pushBlocker(blockers, "oracle_sources_under_floor", oracleSourcesReachable);
  }

  if (!paybackSnapshot) {
    pushBlocker(blockers, "payback_snapshot_missing");
  } else {
    if (paybackSnapshot.reserveOk !== true) {
      pushBlocker(blockers, "payback_reserve_not_ok", paybackSnapshot.reason || null);
    }
    const pending = paybackSnapshot.accumulatorPendingSats;
    if (typeof pending !== "number") {
      pushBlocker(blockers, "payback_accumulator_unknown");
    } else if (pending < policy.minPaybackSats) {
      pushBlocker(blockers, "payback_below_minimum", pending);
    }
  }

  if (!executorHeartbeat) {
    pushBlocker(blockers, "executor_heartbeat_missing");
  } else {
    const ageSec = executorHeartbeat.ageSec;
    if (typeof ageSec !== "number") {
      pushBlocker(blockers, "executor_heartbeat_age_unknown");
    } else if (ageSec > policy.maxHeartbeatStaleSec) {
      pushBlocker(blockers, "executor_heartbeat_stale", ageSec);
    }
  }

  if (typeof staleQuoteCount !== "number") {
    pushBlocker(blockers, "stale_quote_count_unknown");
  } else if (staleQuoteCount > 0) {
    pushBlocker(blockers, "stale_quotes_present", staleQuoteCount);
  }

  return {
    policy: "stage_gate",
    observedAt: now,
    decision: blockers.length === 0 ? "READY" : "BLOCKED",
    ready: blockers.length === 0,
    blockers,
    signals: {
      killSwitchDecision: killSwitch?.decision || null,
      autoKillTriggerCount24h: triggerCount,
      drawdown24hUsd,
      oracleSourcesReachable,
      paybackReserveOk: paybackSnapshot?.reserveOk ?? null,
      paybackPendingSats: paybackSnapshot?.accumulatorPendingSats ?? null,
      executorHeartbeatAgeSec: executorHeartbeat?.ageSec ?? null,
      staleQuoteCount,
    },
    thresholds: policy,
  };
}
