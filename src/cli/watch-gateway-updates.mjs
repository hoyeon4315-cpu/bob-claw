#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { formatGatewayUpdateAlert, sendTelegramMessage } from "../notify/telegram.mjs";
import { runGatewayUpdateWatch } from "../watch/gateway-update-watch.mjs";

function summarizeResult(result) {
  const lines = [];
  lines.push(`updateDetected=${result.updateDetected}`);
  lines.push(`changeReasons=${result.changeReasons.join(",") || "none"}`);
  lines.push(`routeCount=${result.snapshot.routeCount}`);
  lines.push(`chains=${result.snapshot.chains.join(",")}`);
  lines.push(`routeHash=${result.snapshot.routeHash}`);
  lines.push(`schemaHash=${result.schemaHash}`);
  lines.push(`probeHealthHash=${result.probeHealthHash}`);
  lines.push(`addedRoutes=${result.diff.addedRoutes.length}`);
  lines.push(`removedRoutes=${result.diff.removedRoutes.length}`);
  lines.push(`addedChains=${result.diff.addedChains.join(",") || "none"}`);
  lines.push(`removedChains=${result.diff.removedChains.join(",") || "none"}`);
  lines.push(`probeOk=${result.probes.filter((probe) => probe.ok).length}/${result.probes.length}`);
  lines.push(`probeFailures=${result.probeFailures.length}`);
  return lines.join("\n");
}

function sample(items, limit = 20) {
  return items.slice(0, limit);
}

function buildAlertRecord(result) {
  return {
    observedAt: result.observedAt,
    updateDetected: result.updateDetected,
    changeReasons: result.changeReasons,
    routeCount: result.snapshot.routeCount,
    chains: result.snapshot.chains,
    routeHash: result.snapshot.routeHash,
    schemaHash: result.schemaHash,
    routeDiff: {
      changed: result.diff.changed,
      reason: result.diff.reason,
      addedRoutesCount: result.diff.addedRoutes.length,
      removedRoutesCount: result.diff.removedRoutes.length,
      addedRoutesSample: sample(result.diff.addedRoutes),
      removedRoutesSample: sample(result.diff.removedRoutes),
      addedChains: result.diff.addedChains,
      removedChains: result.diff.removedChains,
      addedTokensCount: result.diff.addedTokens.length,
      removedTokensCount: result.diff.removedTokens.length,
      addedTokensSample: sample(result.diff.addedTokens),
      removedTokensSample: sample(result.diff.removedTokens),
    },
    schemaDiff: result.schemaDiff,
    probeHealthDiff: result.probeHealthDiff,
    probeFailures: result.probeFailures,
    probes: result.probes.map((probe) => ({
      ok: probe.ok,
      routeKey: probe.routeKey,
      latencyMs: probe.latencyMs || null,
      shape: probe.shape || null,
      error: probe.error || null,
    })),
  };
}

async function main() {
  const store = new JsonlStore(config.dataDir);
  const previousRecords = await readJsonl(config.dataDir, "gateway-update-snapshots");
  const previousRecord = previousRecords.at(-1) || null;
  const result = await runGatewayUpdateWatch({
    gatewayApiBase: config.gatewayApiBase,
    previousSnapshot: previousRecord?.snapshot || null,
    previousSchemaHash: previousRecord?.schemaHash || null,
    previousSchemaShapes: previousRecord?.schemaShapes || null,
    previousProbeHealthHash: previousRecord?.probeHealthHash || null,
    evmRecipient: config.verifyRecipient,
    btcRecipient: config.verifyBtcRecipient,
  });

  await store.append("gateway-update-snapshots", result);
  if (result.updateDetected) {
    await store.append("gateway-update-alerts", buildAlertRecord(result));
    const telegramResult = await sendTelegramMessage({
      botToken: config.telegramBotToken,
      chatId: config.telegramChatId,
      text: formatGatewayUpdateAlert(result),
    });
    console.log(`telegram=${telegramResult.sent ? "sent" : `skipped:${telegramResult.reason}`}`);
  }

  console.log(summarizeResult(result));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
