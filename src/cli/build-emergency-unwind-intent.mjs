#!/usr/bin/env node

import { buildEmergencyUnwindIntent } from "../executor/policy/emergency-unwind-intent.mjs";

function main() {
  const now = new Date().toISOString();
  const intent = buildEmergencyUnwindIntent({
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    emergencyUnwindPath: ["repay borrow asset", "withdraw collateral", "bridge or swap back to settlement path"],
    triggers: ["health_factor_below_min"],
    positionState: { currentHealthFactor: 1.28, currentLiquidationBufferPct: 11 },
    metadata: { slippagePct: 0.5, realizedNetPnlBtc: -0.001 },
    now,
  });

  intent.tx = {
    to: "0x000000000000000000000000000000000000dEaD",
    data: "0x",
    value: "0",
    gasLimit: "30000",
  };

  const message = {
    command: "sign_and_broadcast",
    intent,
    awaitConfirmation: true,
    confirmations: 1,
    timeoutMs: 120_000,
  };

  console.log(JSON.stringify(message));
}

main();
