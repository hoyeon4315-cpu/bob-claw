import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  HOLD_LIFECYCLE_EVIDENCE_REQUIREMENTS,
  NEXT_LEGAL_CAPITAL_ACTIONS,
  nextLegalCapitalAction,
} from "../src/strategy/next-legal-capital-action.mjs";

test("eligible candidate with no blockers and positive EV emits enter", () => {
  const result = nextLegalCapitalAction({
    blockers: [],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.0534,
  });
  assert.equal(result.action, "enter");
  assert.equal(result.reason, "candidate_eligible");
  assert.equal(result.evidenceComplete, true);
  assert.deepEqual(result.missingEvidence, []);
});

test("open_position_active blocker emits hold with incomplete lifecycle evidence", () => {
  const result = nextLegalCapitalAction({
    blockers: ["open_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.0534,
  });
  assert.equal(result.action, "hold");
  assert.equal(result.reason, "open_position_active");
  assert.equal(result.evidenceComplete, false);
  assert.deepEqual(result.missingEvidence, [...HOLD_LIFECYCLE_EVIDENCE_REQUIREMENTS]);
});

test("open_pendle_position_active blocker still emits hold (no Pendle-only suppression)", () => {
  const result = nextLegalCapitalAction({
    blockers: ["open_pendle_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.04,
  });
  assert.equal(result.action, "hold");
  assert.equal(result.reason, "open_pendle_position_active");
  assert.equal(result.evidenceComplete, false);
});

test("entry duplicate guard remains intact: same opportunity open + positive EV still rejected for entry", () => {
  const result = nextLegalCapitalAction({
    blockers: ["open_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 5,
  });
  assert.notEqual(result.action, "enter");
});

test("inventory shortfall maps to refill", () => {
  const result = nextLegalCapitalAction({
    blockers: ["live_inventory_below_required_notional"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.02,
  });
  assert.equal(result.action, "refill");
  assert.equal(result.evidenceComplete, true);
});

test("native gas missing maps to refill", () => {
  const result = nextLegalCapitalAction({
    blockers: ["native_gas_missing"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.02,
  });
  assert.equal(result.action, "refill");
});

test("missing protocol executor maps to bind_executor", () => {
  const result = nextLegalCapitalAction({
    blockers: ["protocol_executor_missing"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.02,
  });
  assert.equal(result.action, "bind_executor");
});

test("cap-exceeded safety blocker emits no_trade_safety", () => {
  const result = nextLegalCapitalAction({
    blockers: ["per_tx_cap_exceeded"],
    capResult: { status: "blocked" },
    expectedRealizedNetUsd: 0.5,
  });
  assert.equal(result.action, "no_trade_safety");
  assert.equal(result.reason, "per_tx_cap_exceeded");
});

test("non-gateway chain emits no_trade_safety", () => {
  const result = nextLegalCapitalAction({
    blockers: ["chain_not_official_gateway_destination"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.5,
  });
  assert.equal(result.action, "no_trade_safety");
});

test("cooldown active maps to hold (no missing lifecycle evidence)", () => {
  const result = nextLegalCapitalAction({
    blockers: ["recent_execution_cooldown_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.02,
  });
  assert.equal(result.action, "hold");
  assert.equal(result.evidenceComplete, true);
});

test("missing receipt capital-audit path maps to reconcile_receipt", () => {
  const result = nextLegalCapitalAction({
    blockers: ["receipt_path_missing"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.02,
  });
  assert.equal(result.action, "reconcile_receipt");
});

test("ev not positive without lifecycle blocker emits no_trade_safety", () => {
  const result = nextLegalCapitalAction({
    blockers: ["ev_not_positive"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: -0.04,
  });
  assert.equal(result.action, "no_trade_safety");
});

test("compound blocker key with colon suffix matches by prefix", () => {
  const result = nextLegalCapitalAction({
    blockers: ["same_chain_unprofitable:need_$24_on_base"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: -0.04,
  });
  assert.equal(result.action, "no_trade_safety");
});

test("missing-candidate placeholder still gets a structured action (no vague NO_TRADE)", () => {
  const result = nextLegalCapitalAction({
    blockers: ["aggressive_velocity_candidate_missing"],
  });
  assert.equal(result.action, "no_trade_safety");
});

test("priority order: safety beats lifecycle (cap blocker beats open_position_active)", () => {
  const result = nextLegalCapitalAction({
    blockers: ["per_tx_cap_exceeded", "open_position_active"],
    capResult: { status: "blocked" },
    expectedRealizedNetUsd: 0.5,
  });
  assert.equal(result.action, "no_trade_safety");
  assert.equal(result.reason, "per_tx_cap_exceeded");
});

test("priority order: open_position_active beats inventory_missing (existing position must be lifecycled first)", () => {
  const result = nextLegalCapitalAction({
    blockers: ["inventory_missing", "open_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.04,
  });
  assert.equal(result.action, "hold");
  assert.equal(result.reason, "open_position_active");
});

function envelope(overrides = {}) {
  const base = {};
  for (const key of [
    "position_health",
    "position_maturity_or_redeemability",
    "exit_or_redeem_ev",
    "claimable_or_harvest_amount",
    "receipt_or_closed_at_state",
    "cost_floor",
  ]) {
    base[key] = { status: "evidenced", value: {}, provenance: "test", observedAt: null };
  }
  return { ...base, ...overrides };
}

test("open + lifecycle evidence complete + not matured + no claimable -> hold true_hold_noop", () => {
  const result = nextLegalCapitalAction({
    blockers: ["open_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.078,
    lifecycleEvidence: envelope({
      position_maturity_or_redeemability: { status: "evidenced", value: { matured: false }, provenance: "test" },
      claimable_or_harvest_amount: { status: "not_applicable", value: {}, provenance: "test" },
      exit_or_redeem_ev: { status: "evidenced", value: { expectedNetUsd: 0.078 }, provenance: "test" },
      cost_floor: { status: "evidenced", value: { costFloorUsd: 0.06 }, provenance: "test" },
      receipt_or_closed_at_state: {
        status: "evidenced",
        value: { status: "open", closedAt: null },
        provenance: "test",
      },
    }),
  });
  assert.equal(result.action, "hold");
  assert.equal(result.holdQuality, "true_hold_noop");
  assert.equal(result.evidenceComplete, true);
  assert.equal(result.exitEvUsd, 0.078);
  assert.equal(result.costFloorUsd, 0.06);
});

test("open + matured position -> redeem", () => {
  const result = nextLegalCapitalAction({
    blockers: ["open_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.078,
    lifecycleEvidence: envelope({
      position_maturity_or_redeemability: {
        status: "evidenced",
        value: { matured: true, redeemable: true },
        provenance: "test",
      },
      claimable_or_harvest_amount: { status: "not_applicable", value: {}, provenance: "test" },
      receipt_or_closed_at_state: {
        status: "evidenced",
        value: { status: "open", closedAt: null },
        provenance: "test",
      },
    }),
  });
  assert.equal(result.action, "redeem");
  assert.equal(result.evidenceComplete, true);
});

test("open + position already closed -> reconcile_receipt", () => {
  const result = nextLegalCapitalAction({
    blockers: ["open_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.078,
    lifecycleEvidence: envelope({
      receipt_or_closed_at_state: {
        status: "evidenced",
        value: { status: "closed", closedAt: "2026-05-18T00:00:00Z" },
        provenance: "test",
      },
    }),
  });
  assert.equal(result.action, "reconcile_receipt");
});

test("open + claimable rewards ready -> claim", () => {
  const result = nextLegalCapitalAction({
    blockers: ["open_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.05,
    lifecycleEvidence: envelope({
      position_maturity_or_redeemability: { status: "evidenced", value: { matured: false }, provenance: "test" },
      claimable_or_harvest_amount: {
        status: "evidenced",
        value: { totalClaimableUsd: 0.33, claimPlanStatus: "ready", readyChainCount: 1 },
        provenance: "test",
      },
      receipt_or_closed_at_state: {
        status: "evidenced",
        value: { status: "open", closedAt: null },
        provenance: "test",
      },
    }),
  });
  assert.equal(result.action, "claim");
});

test("open + partial evidence -> hold with holdQuality=incomplete_evidence and missingProducers names producers", () => {
  const result = nextLegalCapitalAction({
    blockers: ["open_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.05,
    lifecycleEvidence: envelope({
      exit_or_redeem_ev: {
        status: "missing",
        value: { provenanceKind: "missing_exit_ev_producer", producerName: "pendle_yt_exit_from_position" },
        provenance: "pendle_yt_exit_from_position",
      },
      cost_floor: {
        status: "missing",
        value: { producerName: "exit_cost_floor_producer" },
        provenance: "exit_cost_floor_producer",
      },
    }),
  });
  assert.equal(result.action, "hold");
  assert.equal(result.holdQuality, "incomplete_evidence");
  assert.equal(result.evidenceComplete, false);
  assert.deepEqual(result.missingEvidence, ["exit_or_redeem_ev", "cost_floor"]);
  assert.deepEqual(result.missingProducers, [
    "exit_or_redeem_ev::pendle_yt_exit_from_position",
    "cost_floor::exit_cost_floor_producer",
  ]);
});

test("open + proxy exit EV (not accepted by policy) -> hold incomplete_evidence + missingProducers names true producer", () => {
  const result = nextLegalCapitalAction({
    blockers: ["open_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.05,
    lifecycleEvidence: envelope({
      exit_or_redeem_ev: {
        status: "proxy",
        value: {
          expectedNetUsd: 0.053,
          provenanceKind: "entry_canary_ev_proxy",
          proxyAcceptedByPolicy: false,
          trueExitProducerName: "pendle_yt_exit_from_position",
        },
        provenance: "pendle-yt-dry-run-latest.json::entry_canary_ev_proxy",
      },
    }),
  });
  assert.equal(result.action, "hold");
  assert.equal(result.holdQuality, "incomplete_evidence");
  assert.equal(result.evidenceComplete, false);
  assert.deepEqual(result.proxyEvidenceKeys, ["exit_or_redeem_ev"]);
  assert.deepEqual(result.missingEvidence, ["exit_or_redeem_ev"]);
  assert.deepEqual(result.missingProducers, ["exit_or_redeem_ev::pendle_yt_exit_from_position"]);
  assert.equal(result.exitEvProvenanceKind, "entry_canary_ev_proxy");
});

test("open + proxy exit EV (accepted by policy) -> hold true_hold_noop and proxy treated as evidenced", () => {
  const result = nextLegalCapitalAction({
    blockers: ["open_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 0.05,
    lifecycleEvidence: envelope({
      exit_or_redeem_ev: {
        status: "proxy",
        value: {
          expectedNetUsd: 0.053,
          provenanceKind: "entry_canary_ev_proxy",
          proxyAcceptedByPolicy: true,
          trueExitProducerName: "pendle_yt_exit_from_position",
        },
        provenance: "pendle-yt-dry-run-latest.json::entry_canary_ev_proxy",
      },
    }),
  });
  assert.equal(result.action, "hold");
  assert.equal(result.holdQuality, "true_hold_noop");
  assert.equal(result.evidenceComplete, true);
});

test("open + true exit EV positive (evidenced provenanceKind=true_exit_ev) -> action exit with dispatchEligibility flag", () => {
  const result = nextLegalCapitalAction({
    blockers: ["open_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 99.94,
    lifecycleEvidence: envelope({
      position_maturity_or_redeemability: { status: "evidenced", value: { matured: false }, provenance: "test" },
      claimable_or_harvest_amount: { status: "not_applicable", value: {}, provenance: "test" },
      exit_or_redeem_ev: {
        status: "evidenced",
        value: { expectedNetUsd: 99.94, provenanceKind: "true_exit_ev", producerName: "pendle_yt_exit_from_position" },
        provenance: "pendle-yt-exit-from-position-latest.json::true_exit_ev",
      },
      cost_floor: {
        status: "evidenced",
        value: { costFloorUsd: 0.06 },
        provenance: "pendle-yt-exit-from-position-latest.json",
      },
      receipt_or_closed_at_state: { status: "evidenced", value: { status: "open" }, provenance: "test" },
    }),
  });
  assert.equal(result.action, "exit");
  assert.equal(result.reason, "true_exit_ev_positive");
  assert.equal(result.evidenceComplete, true);
  assert.equal(result.producer, "pendle_yt_exit_from_position");
  assert.equal(result.dispatchEligibility, "exit_executor_not_bound");
  assert.equal(result.exitEvUsd, 99.94);
  assert.equal(result.exitEvProvenanceKind, "true_exit_ev");
  assert.equal(result.costFloorUsd, 0.06);
});

test("open + true exit EV non-positive (evidenced provenanceKind=true_exit_ev) -> hold true_hold_noop with exact net/cost", () => {
  const result = nextLegalCapitalAction({
    blockers: ["open_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: -0.04,
    lifecycleEvidence: envelope({
      position_maturity_or_redeemability: { status: "evidenced", value: { matured: false }, provenance: "test" },
      claimable_or_harvest_amount: { status: "not_applicable", value: {}, provenance: "test" },
      exit_or_redeem_ev: {
        status: "evidenced",
        value: { expectedNetUsd: -0.04, provenanceKind: "true_exit_ev", producerName: "pendle_yt_exit_from_position" },
        provenance: "pendle-yt-exit-from-position-latest.json::true_exit_ev",
      },
      cost_floor: {
        status: "evidenced",
        value: { costFloorUsd: 0.06 },
        provenance: "pendle-yt-exit-from-position-latest.json",
      },
      receipt_or_closed_at_state: { status: "evidenced", value: { status: "open" }, provenance: "test" },
    }),
  });
  assert.equal(result.action, "hold");
  assert.equal(result.holdQuality, "true_hold_noop");
  assert.equal(result.evidenceComplete, true);
  assert.equal(result.exitEvUsd, -0.04);
  assert.equal(result.exitEvProvenanceKind, "true_exit_ev");
  assert.equal(result.costFloorUsd, 0.06);
  assert.equal(result.producer, "pendle_yt_exit_from_position");
});

test("open + matured + true exit EV positive -> redeem (mature precedence)", () => {
  const result = nextLegalCapitalAction({
    blockers: ["open_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 99,
    lifecycleEvidence: envelope({
      position_maturity_or_redeemability: {
        status: "evidenced",
        value: { matured: true, redeemable: true },
        provenance: "test",
      },
      claimable_or_harvest_amount: { status: "not_applicable", value: {}, provenance: "test" },
      exit_or_redeem_ev: {
        status: "evidenced",
        value: { expectedNetUsd: 99, provenanceKind: "true_exit_ev" },
        provenance: "test",
      },
      cost_floor: { status: "evidenced", value: { costFloorUsd: 0.06 }, provenance: "test" },
      receipt_or_closed_at_state: { status: "evidenced", value: { status: "open" }, provenance: "test" },
    }),
  });
  assert.equal(result.action, "redeem");
  assert.equal(result.reason, "position_matured");
});

test("duplicate-entry safety: open + true exit EV positive still rejects enter for same opportunity", () => {
  const result = nextLegalCapitalAction({
    blockers: ["open_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 99,
    lifecycleEvidence: envelope({
      position_maturity_or_redeemability: { status: "evidenced", value: { matured: false }, provenance: "test" },
      claimable_or_harvest_amount: { status: "not_applicable", value: {}, provenance: "test" },
      exit_or_redeem_ev: {
        status: "evidenced",
        value: { expectedNetUsd: 99, provenanceKind: "true_exit_ev", producerName: "pendle_yt_exit_from_position" },
        provenance: "test",
      },
      cost_floor: { status: "evidenced", value: { costFloorUsd: 0.06 }, provenance: "test" },
      receipt_or_closed_at_state: { status: "evidenced", value: { status: "open" }, provenance: "test" },
    }),
  });
  assert.notEqual(result.action, "enter");
  assert.equal(result.action, "exit");
});

test("duplicate-entry safety: open + proxy exit EV still rejects enter for same opportunity", () => {
  const result = nextLegalCapitalAction({
    blockers: ["open_position_active"],
    capResult: { status: "ready" },
    expectedRealizedNetUsd: 5,
    lifecycleEvidence: envelope({
      exit_or_redeem_ev: {
        status: "proxy",
        value: {
          expectedNetUsd: 5,
          provenanceKind: "entry_canary_ev_proxy",
          proxyAcceptedByPolicy: false,
          trueExitProducerName: "pendle_yt_exit_from_position",
        },
      },
    }),
  });
  assert.notEqual(result.action, "enter");
  assert.equal(result.action, "hold");
});

test("taxonomy lists all 12 named actions and includes hold with evidence requirements", () => {
  assert.equal(NEXT_LEGAL_CAPITAL_ACTIONS.length, 12);
  for (const action of [
    "enter",
    "hold",
    "exit",
    "redeem",
    "settle",
    "claim",
    "harvest",
    "consolidate",
    "refill",
    "reconcile_receipt",
    "bind_executor",
    "no_trade_safety",
  ]) {
    assert.ok(NEXT_LEGAL_CAPITAL_ACTIONS.includes(action), `${action} missing from taxonomy`);
  }
  for (const evidence of [
    "position_health",
    "position_maturity_or_redeemability",
    "exit_or_redeem_ev",
    "claimable_or_harvest_amount",
    "receipt_or_closed_at_state",
    "cost_floor",
  ]) {
    assert.ok(
      HOLD_LIFECYCLE_EVIDENCE_REQUIREMENTS.includes(evidence),
      `${evidence} missing from hold evidence requirements`,
    );
  }
});
