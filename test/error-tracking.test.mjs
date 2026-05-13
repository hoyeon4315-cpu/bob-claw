import assert from "node:assert/strict";
import test from "node:test";

import {
  createErrorTracker,
  createSentryErrorTracker,
  sanitizeErrorTrackingEvent,
  sanitizeErrorTrackingValue,
} from "../src/observability/error-tracking.mjs";

test("sanitizes wallet, signing, secret, and raw payload fields from error context", () => {
  const sanitized = sanitizeErrorTrackingValue({
    component: "strategy_tick",
    walletAddress: "0x000000000000000000000000000000000000dEaD",
    btcAddress: "bc1p809tstru8s6x7accmac2xl3rczcfzzh96myh09gy68d883y4uzushkyww0",
    BURNER_EVM_KEY_PATH: "/Users/love/.config/bob-claw/keys/burner.key",
    telegramToken: "123456:secret-token",
    signedTxPayload: "0x02f8b1828459682f008501a13b860082520894000000000000000000000000000000000000dead",
    nested: {
      apiKey: "sk-live-secret",
      safeStatus: "blocked",
      errorMessage: "failed with seed phrase near wallet",
    },
  });

  assert.equal(sanitized.component, "strategy_tick");
  assert.equal(sanitized.walletAddress, "[REDACTED:sensitive_key]");
  assert.equal(sanitized.btcAddress, "[REDACTED:sensitive_key]");
  assert.equal(sanitized.BURNER_EVM_KEY_PATH, "[REDACTED:sensitive_key]");
  assert.equal(sanitized.telegramToken, "[REDACTED:sensitive_key]");
  assert.equal(sanitized.signedTxPayload, "[REDACTED:sensitive_key]");
  assert.equal(sanitized.nested.apiKey, "[REDACTED:sensitive_key]");
  assert.equal(sanitized.nested.safeStatus, "blocked");
  assert.equal(sanitized.nested.errorMessage, "[REDACTED:sensitive_value]");
});

test("disabled tracker is no-op for sending but returns sanitized diagnostic previews", () => {
  const tracker = createErrorTracker({
    enabled: false,
    environment: "test",
    component: "unit",
    release: "local",
  });

  tracker.setContext("runtime", {
    component: "strategy_tick",
    operatorAddress: "0x000000000000000000000000000000000000dEaD",
  });
  tracker.addBreadcrumb({
    category: "report",
    message: "strategy tick failed for wallet bc1p809tstru8s6x7accmac2xl3rczcfzzh96myh09gy68d883y4uzushkyww0",
    data: { result: "blocked", rawSignedTx: "0x02f8b1828459682f00" },
  });

  const preview = tracker.captureException(new Error("boom"), {
    tags: { component: "strategy_tick", wallet: "0x000000000000000000000000000000000000dEaD" },
    context: { apiKey: "sk-test-secret", status: "blocked" },
  });

  assert.equal(preview.sent, false);
  assert.equal(preview.reason, "disabled");
  assert.equal(preview.event.context.runtime.operatorAddress, "[REDACTED:sensitive_key]");
  assert.equal(preview.event.breadcrumbs[0].message, "[REDACTED:sensitive_value]");
  assert.equal(preview.event.breadcrumbs[0].data.rawSignedTx, "[REDACTED:sensitive_key]");
  assert.equal(preview.event.context.capture.apiKey, "[REDACTED:sensitive_key]");
  assert.equal(preview.event.context.capture.status, "blocked");
  assert.equal(preview.event.tags.wallet, "[REDACTED:sensitive_key]");
});

test("Sentry adapter initializes only when env-gated and sanitizes event hooks", async () => {
  const calls = [];
  const sentry = {
    init(options) {
      calls.push(["init", options]);
    },
    addBreadcrumb(breadcrumb) {
      calls.push(["breadcrumb", breadcrumb]);
    },
    setContext(name, context) {
      calls.push(["context", name, context]);
    },
    captureException(error, scope) {
      calls.push(["exception", error, scope]);
      return "event-id";
    },
    captureMessage(message, level, scope) {
      calls.push(["message", message, level, scope]);
      return "message-id";
    },
  };

  const tracker = await createSentryErrorTracker({
    env: {
      BOB_CLAW_ERROR_TRACKING_ENABLED: "1",
      BOB_CLAW_SENTRY_DSN: "https://public@example.invalid/1",
      BOB_CLAW_ERROR_TRACKING_ENVIRONMENT: "ci",
      SENTRY_RELEASE: "test-release",
    },
    importSentry: async () => sentry,
    component: "tests",
  });

  assert.equal(tracker.status.enabled, true);
  assert.equal(calls[0][0], "init");
  assert.equal(calls[0][1].sendDefaultPii, false);
  assert.equal(calls[0][1].attachStacktrace, true);
  assert.equal(calls[0][1].environment, "ci");
  assert.equal(calls[0][1].release, "test-release");

  const event = sanitizeErrorTrackingEvent(
    calls[0][1].beforeSend({
      tags: { wallet: "0x000000000000000000000000000000000000dEaD" },
      extra: { BURNER_BTC_KEY_PATH: "/Users/love/keys/btc.key", result: "blocked" },
    }),
  );
  assert.equal(event.tags.wallet, "[REDACTED:sensitive_key]");
  assert.equal(event.extra.BURNER_BTC_KEY_PATH, "[REDACTED:sensitive_key]");
  assert.equal(event.extra.result, "blocked");

  tracker.addBreadcrumb({
    category: "runtime",
    message: "safe breadcrumb",
    data: { seedPhrase: "never include" },
  });
  tracker.captureMessage("policy report failed", {
    level: "warning",
    context: { component: "report", privateKey: "nope" },
  });

  assert.deepEqual(calls[1], [
    "breadcrumb",
    {
      category: "runtime",
      message: "safe breadcrumb",
      data: { seedPhrase: "[REDACTED:sensitive_key]" },
    },
  ]);
  assert.equal(calls[2][0], "message");
  assert.equal(calls[2][3].context.capture.privateKey, "[REDACTED:sensitive_key]");
});
