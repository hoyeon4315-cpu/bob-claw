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

  assert.equal(ev.expectedNetUsd > 0, true);
  assert.equal(ev.btcAccountingRequired, true);
  assert.equal(ev.paybackConversionRequired, true);
});

test("computeRealizedPnlEv does not haircut native or share-price yield without a reward token", () => {
  const ev = computeRealizedPnlEv({
    candidate: {
      displayedAprPct: 365,
      rewardTokenType: "defaultRewardToken",
      chain: "base",
      protocol: "yo",
    },
    positionUsd: 10,
    holdDays: 1,
    costLedger: {
      p90GasCostUsdForChain: () => null,
      p90BridgeCostUsdForRoute: () => 0,
      p90ClaimCostUsdForProtocol: () => 99,
      p90RewardSwapCostUsdForToken: () => 99,
    },
  });

  assert.equal(ev.grossRewardUsd, 0.1);
  assert.equal(ev.haircutRewardUsd, 0.1);
  assert.equal(ev.p90GasUsd, 0.012);
  assert.equal(ev.p90ClaimUsd, 0);
  assert.equal(ev.p90SwapUsd, 0);
  assert.equal(ev.expectedNetUsd, 0.08800000000000001);
});

test("computeRealizedPnlEv uses tiny canary gas fallback without claim or swap for native share yield", () => {
  const ev = computeRealizedPnlEv({
    candidate: {
      displayedAprPct: 19.8,
      rewardTokenType: "stable",
      chain: "base",
      protocol: "yo",
    },
    positionUsd: 1.39271,
    holdDays: 33.075833333333335,
    costLedger: {
      p90GasCostUsdForChain: () => 0,
      p90BridgeCostUsdForRoute: () => 0,
      p90ClaimCostUsdForProtocol: () => 0.2,
      p90RewardSwapCostUsdForToken: () => 0.3,
    },
  });

  assert.equal(ev.ok, true);
  assert.equal(ev.p90GasUsd, 0.012);
  assert.equal(ev.p90ClaimUsd, 0);
  assert.equal(ev.p90SwapUsd, 0);
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
