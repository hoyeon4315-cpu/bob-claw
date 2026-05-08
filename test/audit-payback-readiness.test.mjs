import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPaybackReadinessAudit } from "../src/cli/audit-payback-readiness.mjs";

const BASE_CONFIG = Object.freeze({
  baseRatio: 0.2,
  minPaybackSats: 50_000,
  maxOfframpCostPctOfPayback: 0.1,
  perPeriodMaxSats: 500_000,
  annualMaxPaybackSats: 26_000_000,
  regimeMultipliers: { bear: 1.2, neutral: 1, bullPeak: 0.7 },
  volMultiplier: { cap: 1, thresholdAnnualized: 0.5 },
  emergencyPause: {
    offrampSlippageBpsMax: 200,
    operatingDrawdownPctMax: 30,
    protocolExploitList: [],
  },
  cronExpression: "0 0 * * 1",
  destinationPath: {
    profitReserveChain: "base",
    swapVenueOrdered: ["cowswap", "uniswap_v3"],
    composerRoute: "layerzero",
    gatewayOfframpStage: "BOB_L2",
    bitcoinDestAddressEnv: "PAYBACK_BTC_DEST_ADDR",
  },
});

function envWithDestination(name, fallback = null) {
  return name === "PAYBACK_BTC_DEST_ADDR" ? "bc1qcycle5payback0000000000000000000000000" : fallback;
}

test("payback readiness audit explains below-minimum carry without changing policy", async () => {
  const audit = await buildPaybackReadinessAudit({
    now: "2026-05-08T00:00:00.000Z",
    paybackConfig: BASE_CONFIG,
    getEnvImpl: envWithDestination,
    auditLogLines: [{ timestamp: "2026-05-08T00:00:00.000Z", realized: { realizedNetPnlSats: 120_000 } }],
    receiptStore: {},
    marketState: { regime: "neutral", realizedVolAnnualized: 0.25 },
  });

  assert.equal(audit.readOnly, true);
  assert.equal(audit.currentConditions.length, 4);
  assert.equal(audit.decision.status, "carry");
  assert.equal(audit.decision.reason, "planned_payback_below_minimum");
  assert.equal(audit.lifetimeZeroTrace.buckets.plannedBelowMinimum.count, 1);
  assert.equal(audit.lifetimeZeroTrace.paidBackSatsLifetime, 0);
});

test("payback readiness audit reports ready conditions when decision is plannable", async () => {
  const audit = await buildPaybackReadinessAudit({
    now: "2026-05-08T00:00:00.000Z",
    paybackConfig: BASE_CONFIG,
    getEnvImpl: envWithDestination,
    auditLogLines: [{ timestamp: "2026-05-08T00:00:00.000Z", realized: { realizedNetPnlSats: 400_000 } }],
    receiptStore: {},
    reserveState: { chain: "base", inputToken: "0x0555e30da8f98308edb960aa94c0db47230d2b9c", amount: "100000" },
    marketState: { regime: "bear", realizedVolAnnualized: 0.25 },
  });

  assert.equal(audit.decision.status, "plan");
  assert.equal(audit.currentConditions.every((item) => item.ok), true);
  assert.equal(audit.dataSources.regimeMultiplier.actualValue, 1.2);
  assert.equal(audit.dataSources.volMultiplier.actualValue, 1);
});

test("payback readiness audit classifies emergency pause as its own lifetime-zero bucket", async () => {
  const audit = await buildPaybackReadinessAudit({
    now: "2026-05-08T00:00:00.000Z",
    paybackConfig: BASE_CONFIG,
    getEnvImpl: envWithDestination,
    auditLogLines: [{ timestamp: "2026-05-08T00:00:00.000Z", realized: { realizedNetPnlSats: 1_000_000 } }],
    receiptStore: {},
    riskState: { operatingDrawdownPct: 31 },
  });

  assert.equal(audit.decision.status, "paused");
  assert.equal(audit.lifetimeZeroTrace.buckets.emergencyPause.count, 1);
  assert.equal(audit.currentConditions.find((item) => item.id === "emergency_pause_clear").ok, false);
});

test("payback readiness audit surfaces configured and runtime multiplier data sources", async () => {
  const audit = await buildPaybackReadinessAudit({
    now: "2026-05-08T00:00:00.000Z",
    paybackConfig: BASE_CONFIG,
    getEnvImpl: envWithDestination,
    auditLogLines: [],
    receiptStore: {},
    marketState: {
      regime: "bullPeak",
      regimeSourcePath: "data/payback-market-state.json",
      realizedVolAnnualized: 1,
      realizedVolSourcePath: "data/btc-volatility.json",
    },
  });

  assert.equal(audit.dataSources.regimeMultiplier.actualValue, 0.7);
  assert.equal(audit.dataSources.regimeMultiplier.runtimeSourcePath, "data/payback-market-state.json");
  assert.equal(audit.dataSources.volMultiplier.actualValue, 0.5);
  assert.equal(audit.dataSources.volMultiplier.runtimeSourcePath, "data/btc-volatility.json");
});
