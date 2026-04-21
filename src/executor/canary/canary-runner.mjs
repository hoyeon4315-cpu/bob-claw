// Per-adapter canary runner state machine.
//
// Plan §5b.5 T21. Each strategy/adapter walks a four-stage promotion
// ladder before it is allowed to run at its target cap:
//
//   dry_run  — offline/shadow only; collects N measured loop observations.
//   canary_1 —   5_000 sats cap, must complete ≥1 successful signed fill
//                with realized net > 0 (post round-trip).
//   canary_7 —  50_000 sats cap, must run for 7 days without demotion AND
//                realized net ≥ minNetSats.
//   live     — full strategy cap (from src/config/strategy-caps.mjs).
//
// Pure function. No I/O. No LLM. Caller supplies the adapter id, the
// current recorded stage, measured receipt stats, and the current time;
// module returns:
//
//   { nextStage, action, capRequestSats, reason, detail }
//
// `action` is one of:
//   hold               — stay where you are
//   promote_pr         — emit a PR that flips autoExecute / raises cap
//   demote_and_disable — immediate unwind + autoExecute=false (cap stays,
//                        adapter is off until operator commits a re-entry)
//
// Promotion to a higher cap ALWAYS returns action="promote_pr" — never
// mutates caps at runtime. Caller emits the PR-bound intent; a human
// (or merge bot) lands the config diff. Invariant #5 (caps = code).
//
// Demotion is the one thing this module permits to happen immediately
// because the runtime has already been authorized to sign at the lower
// cap; turning the adapter off is allowed without a new PR.

const STAGES = Object.freeze({
  DRY_RUN: "dry_run",
  CANARY_1: "canary_1",
  CANARY_7: "canary_7",
  LIVE: "live",
  DISABLED: "disabled",
});

const ACTIONS = Object.freeze({
  HOLD: "hold",
  PROMOTE_PR: "promote_pr",
  DEMOTE_AND_DISABLE: "demote_and_disable",
});

const DEFAULT_THRESHOLDS = Object.freeze({
  dryRunMinObservations: 8,
  canary1CapSats: 5_000,
  canary7CapSats: 50_000,
  canary7DurationMs: 7 * 24 * 60 * 60 * 1000,
  canary7MinNetSats: 100,
  maxConsecutiveFailures: 3,
  maxRealizedLossSats: 10_000,
});

const DAY_MS = 24 * 60 * 60 * 1000;

function parseTs(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

function finiteNonNeg(v) {
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function hold(stage, capSats, reason, detail) {
  return Object.freeze({
    nextStage: stage,
    action: ACTIONS.HOLD,
    capRequestSats: capSats,
    reason,
    detail: detail == null ? null : detail,
  });
}

function promote(nextStage, capRequestSats, reason, detail) {
  return Object.freeze({
    nextStage,
    action: ACTIONS.PROMOTE_PR,
    capRequestSats,
    reason,
    detail: detail == null ? null : detail,
  });
}

function demote(reason, detail) {
  return Object.freeze({
    nextStage: STAGES.DISABLED,
    action: ACTIONS.DEMOTE_AND_DISABLE,
    capRequestSats: 0,
    reason,
    detail: detail == null ? null : detail,
  });
}

// Universal demotion check — runs regardless of stage.
function checkHardStop(stats, thresholds) {
  const fails = finiteNonNeg(stats.consecutiveFailures);
  if (fails >= thresholds.maxConsecutiveFailures) {
    return demote("consecutive_failures", {
      fails,
      limit: thresholds.maxConsecutiveFailures,
    });
  }
  const loss = finiteNonNeg(stats.realizedLossSats);
  if (loss > thresholds.maxRealizedLossSats) {
    return demote("realized_loss_exceeded", {
      lossSats: loss,
      limit: thresholds.maxRealizedLossSats,
    });
  }
  return null;
}

export function evaluateCanaryPromotion({
  adapterId,
  currentStage = STAGES.DRY_RUN,
  stats = {},
  now = new Date().toISOString(),
  thresholds = DEFAULT_THRESHOLDS,
  stageEnteredAt = null,
} = {}) {
  if (!adapterId || typeof adapterId !== "string") {
    throw new TypeError("adapterId is required");
  }
  if (!Object.values(STAGES).includes(currentStage)) {
    throw new TypeError(`unknown stage: ${currentStage}`);
  }
  const nowMs = parseTs(now);
  if (nowMs == null) {
    throw new TypeError("now must be a valid timestamp");
  }
  const t = Object.freeze({ ...DEFAULT_THRESHOLDS, ...thresholds });

  // Disabled is terminal until a PR re-enables. No auto-recovery.
  if (currentStage === STAGES.DISABLED) {
    return Object.freeze({
      adapterId,
      currentStage,
      observedAt: now,
      ...hold(STAGES.DISABLED, 0, "disabled_requires_pr", null),
    });
  }

  // Hard-stop applies to every active stage.
  const stop = checkHardStop(stats, t);
  if (stop) {
    return Object.freeze({ adapterId, currentStage, observedAt: now, ...stop });
  }

  if (currentStage === STAGES.DRY_RUN) {
    const obs = finiteNonNeg(stats.dryRunObservations);
    if (obs >= t.dryRunMinObservations) {
      return Object.freeze({
        adapterId,
        currentStage,
        observedAt: now,
        ...promote(STAGES.CANARY_1, t.canary1CapSats, "dry_run_complete", {
          observations: obs,
          required: t.dryRunMinObservations,
        }),
      });
    }
    return Object.freeze({
      adapterId,
      currentStage,
      observedAt: now,
      ...hold(STAGES.DRY_RUN, 0, "dry_run_insufficient", {
        observations: obs,
        required: t.dryRunMinObservations,
      }),
    });
  }

  if (currentStage === STAGES.CANARY_1) {
    const fills = finiteNonNeg(stats.successfulFills);
    const netSats = Number.isFinite(stats.realizedNetSats) ? stats.realizedNetSats : 0;
    if (fills >= 1 && netSats > 0) {
      return Object.freeze({
        adapterId,
        currentStage,
        observedAt: now,
        ...promote(STAGES.CANARY_7, t.canary7CapSats, "canary_1_complete", {
          fills,
          realizedNetSats: netSats,
        }),
      });
    }
    return Object.freeze({
      adapterId,
      currentStage,
      observedAt: now,
      ...hold(
        STAGES.CANARY_1,
        t.canary1CapSats,
        fills < 1 ? "canary_1_no_fills" : "canary_1_net_not_positive",
        { fills, realizedNetSats: netSats },
      ),
    });
  }

  if (currentStage === STAGES.CANARY_7) {
    const enteredMs = parseTs(stageEnteredAt);
    const elapsedMs = enteredMs == null ? 0 : nowMs - enteredMs;
    const netSats = Number.isFinite(stats.realizedNetSats) ? stats.realizedNetSats : 0;
    const durationOk = elapsedMs >= t.canary7DurationMs;
    const netOk = netSats >= t.canary7MinNetSats;
    if (durationOk && netOk) {
      return Object.freeze({
        adapterId,
        currentStage,
        observedAt: now,
        ...promote(STAGES.LIVE, null, "canary_7_complete", {
          elapsedMs,
          requiredMs: t.canary7DurationMs,
          elapsedDays: Math.floor(elapsedMs / DAY_MS),
          realizedNetSats: netSats,
        }),
      });
    }
    return Object.freeze({
      adapterId,
      currentStage,
      observedAt: now,
      ...hold(
        STAGES.CANARY_7,
        t.canary7CapSats,
        !durationOk ? "canary_7_duration_pending" : "canary_7_net_below_min",
        {
          elapsedMs,
          requiredMs: t.canary7DurationMs,
          realizedNetSats: netSats,
          minNetSats: t.canary7MinNetSats,
        },
      ),
    });
  }

  // LIVE: terminal (no further promotion). Only hard-stop can demote.
  return Object.freeze({
    adapterId,
    currentStage: STAGES.LIVE,
    observedAt: now,
    ...hold(STAGES.LIVE, null, "live_steady_state", null),
  });
}

export { STAGES, ACTIONS, DEFAULT_THRESHOLDS };
