import { PAYBACK_CONFIG } from "../config/payback.mjs";
import { loadPaybackPolicyConfig } from "../executor/payback/scheduler.mjs";
import { buildDefaultRiskPolicy } from "../risk/policy.mjs";

function countByStatus(entries = []) {
  return (entries || []).reduce((counts, entry) => {
    const status = entry?.status || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function statusPriority(status = null) {
  return {
    missing: 0,
    partial: 1,
    implemented: 2,
  }[status] ?? 3;
}

function entry({
  id,
  label,
  status,
  reason,
  docRefs = [],
  codeRefs = [],
  details = null,
}) {
  return {
    id,
    label,
    status,
    reason,
    docRefs,
    codeRefs,
    details,
  };
}

export function buildFormulaAudit({
  riskPolicy = buildDefaultRiskPolicy(),
  paybackPolicy = loadPaybackPolicyConfig(PAYBACK_CONFIG),
  now = null,
} = {}) {
  const entries = [
    entry({
      id: "payback_core_formula",
      label: "Payback core formula",
      status: "implemented",
      reason: "scheduler applies baseRatio, regimeMultiplier, volMultiplier, minimum threshold, cost cap, and annual/per-period caps",
      docRefs: [
        "docs/research/payback-rationale.md §1",
        "AGENTS.md Payback Model",
      ],
      codeRefs: [
        "src/executor/payback/scheduler.mjs:192",
        "src/executor/payback/scheduler.mjs:489",
        "src/executor/payback/scheduler.mjs:492",
        "src/executor/payback/scheduler.mjs:793",
      ],
      details: {
        baseRatio: paybackPolicy.baseRatio ?? null,
        minPaybackSats: paybackPolicy.minPaybackSats ?? null,
        maxOfframpCostPctOfPayback: paybackPolicy.maxOfframpCostPctOfPayback ?? null,
      },
    }),
    entry({
      id: "payback_kpis",
      label: "Payback KPI formulas",
      status: "implemented",
      reason: "accumulator computes BYR, CG, TBR, roundTripEfficiency, and daysToBreakeven in sats-first form",
      docRefs: [
        "docs/research/payback-rationale.md §2",
        "AGENTS.md Payback Model KPI surface",
      ],
      codeRefs: [
        "src/executor/payback/accumulator.mjs:571",
        "src/executor/payback/accumulator.mjs:586",
      ],
    }),
    entry({
      id: "leverage_safety_thresholds",
      label: "Leverage safety thresholds",
      status: "implemented",
      reason: "healthFactorMin and liquidationBufferPct are validated and enforced in runtime gates",
      docRefs: [
        "docs/live-verification-plan.md leverage sections",
        "AGENTS.md Risk Limits",
      ],
      codeRefs: [
        "src/executor/policy/hf-check.mjs:44",
        "src/risk/execution-gate.mjs:138",
        "src/strategy/wrapped-btc-lending-loop-slice.mjs:77",
        "src/strategy/recursive-lending-loop-slice.mjs:141",
      ],
    }),
    entry({
      id: "profit_floor_and_variance_gate",
      label: "Profit floor and variance gate",
      status: "partial",
      reason: "positive-edge logic exists, but default runtime floors are zero and the stricter doc stance is not encoded as default config",
      docRefs: [
        "AGENTS.md Risk Limits",
        "docs/research/ops-costs.md",
      ],
      codeRefs: [
        "src/risk/policy.mjs:18",
        "src/risk/execution-gate.mjs:184",
        "src/strategy/edge-viability.mjs:18",
        "src/strategy/pivot-plan.mjs:47",
      ],
      details: {
        minNetProfitUsd: riskPolicy.minNetProfitUsd ?? null,
        minNetProfitPct: riskPolicy.minNetProfitPct ?? null,
      },
    }),
    entry({
      id: "btc_denominated_strategy_accounting",
      label: "BTC-denominated strategy accounting",
      status: "partial",
      reason: "payback and KPI accounting are sats-first, but route/loop-level BTC ±50% scenario coverage is not surfaced as a recurring audit artifact",
      docRefs: [
        "docs/_archive/bobclaw-guidelines-v3-final.md Part 3.2",
        "docs/_archive/bobclaw-guidelines-v3-final.md Part 12",
        "AGENTS.md Reporting",
      ],
      codeRefs: [
        "src/executor/payback/accumulator.mjs:586",
        "src/executor/payback/dashboard.mjs:237",
      ],
    }),
    entry({
      id: "kelly_based_parameterization",
      label: "Kelly-based parameterization",
      status: "partial",
      reason: "Kelly is used as rationale for static config defaults, not as a live or periodic optimizer",
      docRefs: [
        "docs/research/payback-rationale.md §1.1",
        "docs/_archive/bobclaw-guidelines-v3-final.md Part 6.3",
      ],
      codeRefs: [
        "src/config/payback.mjs:6",
      ],
      details: {
        baseRatio: paybackPolicy.baseRatio ?? null,
        regimeBear: paybackPolicy.regimeMultipliers?.bear ?? null,
        regimeBullPeak: paybackPolicy.regimeMultipliers?.bullPeak ?? null,
      },
    }),
    entry({
      id: "advanced_overfit_statistics",
      label: "Advanced overfit statistics",
      status: "missing",
      reason: "docs call for DSR, PBO, WFE / walk-forward evidence, but current runtime overfit gate is heuristic and does not compute those formulas",
      docRefs: [
        "docs/research/ops-costs.md",
        "docs/_archive/bobclaw-guidelines-v3-final.md Part 12.7",
      ],
      codeRefs: [
        "src/cli/audit-overfit.mjs",
        "src/audit/overfit.mjs",
      ],
    }),
  ];

  const mismatches = [
    {
      id: "risk_policy_zero_profit_floor",
      severity: "high",
      reason: "Default risk policy still uses minNetProfitUsd=0 and minNetProfitPct=0.",
      codeRefs: ["src/risk/policy.mjs:18"],
    },
    {
      id: "no_runtime_dsr_pbo_wfe",
      severity: "high",
      reason: "Overfit docs mention DSR/PBO/WFE, but the runtime audit does not calculate them.",
      codeRefs: ["src/cli/audit-overfit.mjs", "src/audit/overfit.mjs"],
    },
    {
      id: "btc_scenario_audit_missing",
      severity: "medium",
      reason: "No recurring artifact was found for BTC +/-50% strategy-level scenario audit.",
      codeRefs: ["src/executor/payback/dashboard.mjs:237"],
    },
    {
      id: "kelly_is_rationale_not_optimizer",
      severity: "medium",
      reason: "Kelly-derived logic informs config comments but is not re-estimated from BobClaw evidence.",
      codeRefs: ["src/config/payback.mjs:6"],
    },
  ];

  const summary = {
    entryCount: entries.length,
    implementedCount: entries.filter((item) => item.status === "implemented").length,
    partialCount: entries.filter((item) => item.status === "partial").length,
    missingCount: entries.filter((item) => item.status === "missing").length,
    mismatchCount: mismatches.length,
    statusCounts: countByStatus(entries),
    topGap:
      [...entries].sort((left, right) => statusPriority(left?.status) - statusPriority(right?.status))[0] || null,
  };

  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    summary,
    entries,
    mismatches,
    notes: [
      "Implemented means a concrete runtime or persisted reporting calculation exists in repo code.",
      "Partial means the formula or principle influences config/rationale or some surfaces, but not the full recurring audit loop described in docs.",
      "Missing means the docs call for the formula family, but current runtime/reporting code does not compute it directly.",
    ],
  };
}
