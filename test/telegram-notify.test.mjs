import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleIntentCommand } from "../src/executor/signer/daemon.mjs";
import { notifyPolicyRejection } from "../src/executor/signer/policy-alerts.mjs";
import { formatLiveTransactionAlert, notifyLiveTransaction } from "../src/executor/signer/transaction-alerts.mjs";
import { createWatchdogAlerter } from "../src/executor/watchdog/runner.mjs";
import { buildTelegramDeliveryDecision, formatGatewayUpdateAlert, formatPreliveForkExecutionAlert, sendTelegramMessage } from "../src/notify/telegram.mjs";
import { notifyCanaryDecision } from "../src/watch/canary-readiness-watch.mjs";

test("telegram sender skips cleanly when not configured", async () => {
  const result = await sendTelegramMessage({ botToken: "", chatId: "", text: "hello", category: "live_execution_result" });

  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "telegram_not_configured");
});

test("telegram sender suppresses non-transaction categories in transaction-only mode", async () => {
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

test("telegram sender delivers actual transaction categories", async () => {
  let request = null;
  const result = await sendTelegramMessage({
    botToken: "token",
    chatId: "chat",
    text: "hello",
    category: "live_execution_result",
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
  assert.equal(result.category, "live_execution_result");
  assert.match(request.url, /sendMessage$/);
});

test("telegram delivery decision defaults to transaction-only suppression for unspecified categories", () => {
  const decision = buildTelegramDeliveryDecision({});
  assert.equal(decision.mode, "transaction_only");
  assert.equal(decision.category, "unspecified");
  assert.equal(decision.allowed, false);
});

test("telegram suppresses non-transaction ops categories", async () => {
  let fetchCalled = false;
  const result = await sendTelegramMessage({
    botToken: "token",
    chatId: "chat",
    text: "watchdog",
    category: "watchdog_halt",
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("suppressed watchdog alerts should not call fetch");
    },
  });

  assert.equal(fetchCalled, false);
  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "telegram_category_suppressed");
  assert.equal(result.category, "watchdog_halt");
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

test("policy rejection alert is suppressed in transaction-only mode", async () => {
  let payload = null;
  const result = await notifyPolicyRejection({
    intent: { strategyId: "wrapped-btc-loop-base-moonwell", chain: "base", intentType: "strategy_execution" },
    policy: { blockers: ["max_consecutive_failures_reached"] },
    sendImpl: async (args) => {
      payload = args;
      return { sent: true, skipped: false };
    },
  });

  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "transaction_alerts_only");
  assert.equal(payload, null);
});

test("watchdog alerter is suppressed in transaction-only mode", async () => {
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

  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "transaction_alerts_only");
  assert.equal(payload, null);
});

test("live transaction alert is Korean and includes the broadcast hash", () => {
  const text = formatLiveTransactionAlert({
    intent: {
      strategyId: "gateway-btc-funding-transfer",
      chain: "base",
      intentType: "gateway_btc_transfer",
      amountUsd: 12.34,
      metadata: { amountSats: "12345" },
    },
    broadcast: { txHash: `0x${"a".repeat(64)}` },
  });

  assert.match(text, /실제 트랜잭션/);
  assert.match(text, /상태: 브로드캐스트/);
  assert.match(text, /전략: gateway-btc-funding-transfer/);
  assert.match(text, /체인: base/);
  assert.match(text, /BTC 기준: 12345 sats/);
  assert.match(text, /USD 표시: \$12\.34/);
  assert.match(text, /tx: 0xaaaaaaaa\.\.\.aaaaaa/);
});

test("generic probe broadcast alerts are suppressed before Telegram delivery", async () => {
  let payload = null;
  const result = await notifyLiveTransaction({
    intent: {
      strategyId: "token-dex-experiment",
      chain: "base",
      intentType: "strategy_execution",
      amountUsd: 0.1,
    },
    broadcast: { txHash: `0x${"c".repeat(64)}` },
    stage: "broadcasted",
    sendImpl: async (args) => {
      payload = args;
      return { sent: true };
    },
  });

  assert.equal(payload, null);
  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "generic_probe_broadcast_suppressed");
});

test("generic probe confirmed alerts still deliver", async () => {
  let payload = null;
  const result = await notifyLiveTransaction({
    intent: {
      strategyId: "native-dex-experiment",
      chain: "sonic",
      intentType: "strategy_execution",
      amountUsd: 0.1,
    },
    broadcast: { txHash: `0x${"d".repeat(64)}` },
    stage: "confirmed",
    sendImpl: async (args) => {
      payload = args;
      return { sent: true, category: args.category };
    },
  });

  assert.equal(result.sent, true);
  assert.equal(payload.category, "live_execution_result");
  assert.match(payload.text, /상태: 확정/);
});

test("payback broadcast alerts are not suppressed", async () => {
  let payload = null;
  const result = await notifyLiveTransaction({
    intent: {
      strategyId: "payback:2026-W18",
      chain: "base",
      intentType: "payback",
      metadata: { plannedPaybackSats: "50000" },
    },
    broadcast: { txHash: `0x${"e".repeat(64)}` },
    stage: "broadcasted",
    sendImpl: async (args) => {
      payload = args;
      return { sent: true, category: args.category };
    },
  });

  assert.equal(result.sent, true);
  assert.equal(payload.category, "live_execution_result");
  assert.match(payload.text, /전략: payback:2026-W18/);
});

test("signer notifies once in Korean when a transaction is broadcast", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-tx-alert-"));
  const txHash = `0x${"b".repeat(64)}`;
  const notifications = [];
  const now = new Date().toISOString();
  const signers = {
    evm: {
      signIntent: async (intent) => ({
        schemaVersion: 1,
        intentId: intent.intentId,
        strategyId: intent.strategyId,
        chain: intent.chain,
        signerFamily: "evm",
        txHash,
        signedTx: "0xsigned",
        metadata: { nonce: 1 },
      }),
      broadcastSignedIntent: async () => ({ txHash, nonce: 1 }),
    },
  };

  try {
    const result = await handleIntentCommand({
      message: {
        command: "sign_and_broadcast",
        intent: {
          strategyId: "gateway-btc-funding-transfer",
          chain: "base",
          intentType: "gateway_btc_transfer",
          amountUsd: 1,
          quote: { observedAt: now },
          observedAt: now,
          metadata: { amountSats: "1000" },
        },
      },
      signers,
      args: {
        activeBudgetUsd: null,
        killSwitchPath: null,
        autoIngest: false,
      },
      cwd: dir,
      transactionNotifyImpl: async (payload) => {
        notifications.push(payload);
        return { sent: true, skipped: false };
      },
    });

    assert.equal(result.status, "ok");
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].category, "live_execution_result");
    assert.match(notifications[0].text, /실제 트랜잭션/);
    assert.match(notifications[0].text, /상태: 브로드캐스트/);
    assert.match(notifications[0].text, /tx: 0xbbbbbbbb\.\.\.bbbbbb/);
    assert.equal(result.transactionNotification.sent, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("canary readiness alert is suppressed in transaction-only mode", async () => {
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
