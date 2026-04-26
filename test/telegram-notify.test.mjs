import assert from "node:assert/strict";
import { test } from "node:test";
import { notifyPolicyRejection } from "../src/executor/signer/policy-alerts.mjs";
import { createWatchdogAlerter } from "../src/executor/watchdog/runner.mjs";
import { buildTelegramDeliveryDecision, formatGatewayUpdateAlert, formatPreliveForkExecutionAlert, sendTelegramMessage } from "../src/notify/telegram.mjs";
import { notifyCanaryDecision } from "../src/watch/canary-readiness-watch.mjs";

test("telegram sender skips cleanly when not configured", async () => {
  const result = await sendTelegramMessage({ botToken: "", chatId: "", text: "hello", category: "watchdog_halt" });

  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "telegram_not_configured");
});

test("telegram sender suppresses non-ops categories in ops-only mode", async () => {
  let fetchCalled = false;
  const result = await sendTelegramMessage({
    botToken: "token",
    chatId: "chat",
    text: "hello",
    category: "gateway_update",
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("suppressed alerts should not call fetch");
    },
  });

  assert.equal(fetchCalled, false);
  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "telegram_category_suppressed");
  assert.equal(result.category, "gateway_update");
});

test("telegram sender delivers immediate ops categories", async () => {
  let request = null;
  const result = await sendTelegramMessage({
    botToken: "token",
    chatId: "chat",
    text: "hello",
    category: "watchdog_halt",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, result: { message_id: 1 } }),
      };
    },
  });

  assert.equal(result.sent, true);
  assert.equal(result.category, "watchdog_halt");
  assert.match(request.url, /sendMessage$/);
});

test("telegram delivery decision defaults to ops-only suppression for unspecified categories", () => {
  const decision = buildTelegramDeliveryDecision({});
  assert.equal(decision.mode, "ops_only");
  assert.equal(decision.category, "unspecified");
  assert.equal(decision.allowed, false);
});

test("gateway update telegram alert includes reason and live block reminder", () => {
  const text = formatGatewayUpdateAlert({
    observedAt: "2026-04-10T00:00:00.000Z",
    changeReasons: ["probe_health", "eth_family_surface"],
    snapshot: { routeCount: 113, chains: ["bob", "base"] },
    ethFamily: { routeCount: 1 },
    diff: { addedRoutes: [], removedRoutes: [], addedEthFamilyRoutes: ["base:0x0->ethereum:0x0"], removedEthFamilyRoutes: [] },
    probes: [{ ok: true }, { ok: false }],
    probeFailures: [
      {
        routeKey: "bob:btc->bitcoin:btc",
        errorStatus: 500,
        errorCode: "INTERNAL_ERROR",
      },
    ],
  });

  assert.match(text, /reasons: probe_health/);
  assert.match(text, /ethFamilyRoutes: 1/);
  assert.match(text, /ethFamilySurface: \+1 \/ -0/);
  assert.match(text, /audit:eth-family-overfit/);
  assert.match(text, /probeOk: 1\/2/);
  assert.match(text, /liveTrading: still blocked/);
});

test("policy rejection alert is tagged as a strategy halt", async () => {
  let payload = null;
  const result = await notifyPolicyRejection({
    intent: { strategyId: "wrapped-btc-loop-base-moonwell", chain: "base", intentType: "strategy_execution" },
    policy: { blockers: ["max_consecutive_failures_reached"] },
    sendImpl: async (args) => {
      payload = args;
      return { sent: true, skipped: false };
    },
  });

  assert.equal(result.sent, true);
  assert.equal(payload.category, "strategy_halt");
  assert.match(payload.text, /max_consecutive_failures_reached/);
});

test("watchdog alerter is tagged as an ops halt", async () => {
  let payload = null;
  const alerter = createWatchdogAlerter({
    botToken: "token",
    chatId: "chat",
    sendImpl: async (args) => {
      payload = args;
      return { sent: true, skipped: false };
    },
  });

  const result = await alerter({
    evaluation: { status: "stale", stale: true, ageMs: 120_000, ttlMs: 60_000 },
    heartbeatPath: "./state/executor-heartbeat.json",
    killSwitchPath: "./state/kill-switch",
  });

  assert.equal(result.sent, true);
  assert.equal(payload.category, "watchdog_halt");
  assert.match(payload.text, /BOB Claw watchdog halt/);
});

test("canary readiness alert is suppressed in ops-only mode", async () => {
  let fetchCalled = false;
  const result = await notifyCanaryDecision({
    botToken: "token",
    chatId: "chat",
    nextStep: {
      decision: "RUN_EXACT_GAS",
      headline: "Run exact gas estimate for the best prepared route",
      route: { label: "bob->base wBTC.OFT->wBTC.OFT", amount: "10000" },
      reasons: ["exact_src_execution_gas_not_estimated"],
    },
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("suppressed canary alerts should not call fetch");
    },
  });

  assert.equal(fetchCalled, false);
  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "telegram_category_suppressed");
  assert.equal(result.category, "canary_readiness");
});

test("prelive fork execution alert summarizes route transition without raw tx data", () => {
  const text = formatPreliveForkExecutionAlert({
    phase: "fork_confirmed",
    plan: {
      routeLabel: "ethereum->base WBTC->wBTC.OFT",
      amount: "10000",
      targetEnvironment: "external_signed_fork",
    },
    receipt: {
      reconciliationStatus: "reconciled",
      flags: { failed: false },
      realized: {
        actualKnownCostUsd: 0.12,
        realizedNetPnlUsd: 0.41,
      },
    },
    audit: {
      status: "complete",
      missingRecordCount: 0,
    },
  });

  assert.match(text, /phase: fork_confirmed/);
  assert.match(text, /route: ethereum->base WBTC->wBTC.OFT/);
  assert.match(text, /environment: external_signed_fork/);
  assert.match(text, /receipt: reconciled/);
  assert.match(text, /records: complete missing=0/);
  assert.match(text, /liveTrading: still blocked/);
  assert.doesNotMatch(text, /signedTx/i);
});
