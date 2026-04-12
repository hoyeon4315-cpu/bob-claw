import assert from "node:assert/strict";
import { test } from "node:test";
import { formatGatewayUpdateAlert, formatPreliveForkExecutionAlert, sendTelegramMessage } from "../src/notify/telegram.mjs";

test("telegram sender skips cleanly when not configured", async () => {
  const result = await sendTelegramMessage({ botToken: "", chatId: "", text: "hello" });

  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "telegram_not_configured");
});

test("gateway update telegram alert includes reason and live block reminder", () => {
  const text = formatGatewayUpdateAlert({
    observedAt: "2026-04-10T00:00:00.000Z",
    changeReasons: ["probe_health"],
    snapshot: { routeCount: 113, chains: ["bob", "base"] },
    diff: { addedRoutes: [], removedRoutes: [] },
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
  assert.match(text, /probeOk: 1\/2/);
  assert.match(text, /liveTrading: still blocked/);
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
