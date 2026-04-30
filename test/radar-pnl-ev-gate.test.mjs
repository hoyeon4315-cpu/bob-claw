import assert from "node:assert/strict";
import test from "node:test";

import { computeRealizedPnlEv } from "../src/strategy/radar/pnl-ev-gate.mjs";

test("computeRealizedPnlEv accepts positive realized-PnL EV with BTC accounting metadata", () => {
  const ev = computeRealizedPnlEv({
    candidate: {
      displayedAprPct: 365,
      rewardTokenType: "stable",
      chain: "base",
      protocol: "moonwell",
      rewardToken: "USDC",
    },
    positionUsd: 30,
    holdDays: 3,
    costLedger: {
      p90GasCostUsdForChain: () => 0.12,
      p90BridgeCostUsdForRoute: () => 0,
      p90ClaimCostUsdForProtocol: () => 0.1,
      p90RewardSwapCostUsdForToken: () => 0.1,
    },
  });

  assert.equal(ev.expectedNetPnlUsd > 0, true);
  assert.equal(ev.btcAccountingRequired, true);
  assert.equal(ev.paybackConversionRequired, true);
});

test("computeRealizedPnlEv rejects non-positive EV after measured costs", () => {
  const ev = computeRealizedPnlEv({
    candidate: {
      displayedAprPct: 10,
      rewardTokenType: "defaultRewardToken",
      chain: "base",
      protocol: "moonwell",
      rewardToken: "TOKEN",
    },
    positionUsd: 30,
    holdDays: 1,
    costLedger: {
      p90GasCostUsdForChain: () => 1,
      p90BridgeCostUsdForRoute: () => 0,
      p90ClaimCostUsdForProtocol: () => 1,
      p90RewardSwapCostUsdForToken: () => 1,
    },
  });

  assert.equal(ev.ok, false);
  assert.equal(ev.blocker, "realized_pnl_ev_insufficient");
});
