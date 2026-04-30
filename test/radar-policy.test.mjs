import assert from "node:assert/strict";
import test from "node:test";

import { RADAR_POLICY } from "../src/config/radar-policy.mjs";
import { RADAR_SOURCE_ALLOWLIST } from "../src/config/radar-source-allowlist.mjs";

test("radar policy exposes explicit deterministic thresholds", () => {
  assert.equal(RADAR_POLICY.profileId, "onchain_opportunity_radar_aggressive_v1");
  assert.equal(RADAR_POLICY.discoveryCanObserveOutOfScopeChains, true);
  assert.equal(RADAR_POLICY.executionRequiresExistingPolicyPath, true);
  assert.equal(RADAR_POLICY.btcFirstAccounting, true);
  assert.equal(RADAR_POLICY.admissionEvUnit, "realized_net_pnl_usd");
  assert.equal(RADAR_POLICY.thresholds.clusterConfidenceMin, 0.6);
  assert.equal(RADAR_POLICY.thresholds.portableWalletSetMin, 3);
  assert.equal(RADAR_POLICY.thresholds.protocolAgeDaysMin, 30);
  assert.equal(RADAR_POLICY.thresholds.protocolTvlUsdMin, 5_000_000);
  assert.equal(RADAR_POLICY.thresholds.slippageBpsMax, 80);
  assert.equal(RADAR_POLICY.thresholds.mevExposureScoreMax, 35);
  assert.equal(RADAR_POLICY.calibrationStatus, "calibrated_aggressive_v1");
  assert.equal(Object.isFrozen(RADAR_POLICY.thresholds), true);
});

test("radar policy keeps strategy realized and payback delivered as separate states", () => {
  assert.deepEqual(RADAR_POLICY.realizationStates, Object.freeze({
    strategyRealized: "entry_claim_exit_swap_closed_btc_pnl",
    paybackDelivered: "bitcoin_l1_destination_balance_delta",
  }));
});

test("radar source allowlist records what each source can and cannot prove", () => {
  const rawRpc = RADAR_SOURCE_ALLOWLIST.raw_evm_rpc;
  assert.ok(rawRpc);
  assert.equal(rawRpc.status, "enabled");
  assert.ok(rawRpc.proves.includes("transaction_receipts"));
  assert.ok(rawRpc.cannotProve.includes("strategy_profitability"));

  const nansen = RADAR_SOURCE_ALLOWLIST.nansen;
  assert.ok(nansen);
  assert.equal(nansen.status, "unverified_provider_access");
  assert.ok(nansen.cannotProve.includes("bob_claw_portability"));
});
