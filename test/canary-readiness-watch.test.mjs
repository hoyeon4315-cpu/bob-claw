import assert from "node:assert/strict";
import { test } from "node:test";
import { decisionFingerprint, formatCanaryTelegramAlert, formatCanaryWatchSummary } from "../src/watch/canary-readiness-watch.mjs";

test("canary readiness summary includes decision and route", () => {
  const summary = formatCanaryWatchSummary({
    decision: "FUND_AND_APPROVE_WALLET",
    headline: "Fund and approve the estimator wallet before exact gas",
    route: { label: "bob->base wBTC.OFT->wBTC.OFT", amount: "10000" },
    reasons: ["native", "token", "allowance"],
  });

  assert.match(summary, /decision=FUND_AND_APPROVE_WALLET/);
  assert.match(summary, /route=bob->base wBTC.OFT->wBTC.OFT amount=10000/);
  assert.match(summary, /reasons=native,token,allowance/);
});

test("telegram alert formats canary decision updates", () => {
  const text = formatCanaryTelegramAlert({
    decision: "RUN_EXACT_GAS",
    headline: "Run exact gas estimate for the best prepared route",
    route: { label: "bob->base wBTC.OFT->wBTC.OFT", amount: "10000" },
    reasons: ["exact_src_execution_gas_not_estimated"],
  });

  assert.match(text, /BOB Claw canary update/);
  assert.match(text, /decision: RUN_EXACT_GAS/);
  assert.match(text, /route: bob->base wBTC.OFT->wBTC.OFT/);
});

test("decision fingerprint changes when route or reasons change", () => {
  const a = decisionFingerprint({
    decision: "FUND_AND_APPROVE_WALLET",
    route: { routeKey: "bob:token->base:token", amount: "10000" },
    reasons: ["native"],
  });
  const b = decisionFingerprint({
    decision: "FUND_AND_APPROVE_WALLET",
    route: { routeKey: "bob:token->base:token", amount: "10000" },
    reasons: ["native", "token"],
  });

  assert.notEqual(a, b);
});
