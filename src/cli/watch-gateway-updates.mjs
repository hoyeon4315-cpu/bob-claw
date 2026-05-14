#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { formatGatewayUpdateAlert, sendTelegramMessage } from "../notify/telegram.mjs";
import { buildGatewayUpdateAlertRecord } from "../strategy/gateway-update-autopilot.mjs";
import { runGatewayUpdateWatch } from "../watch/gateway-update-watch.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

function summarizeResult(result) {
  const lines = [];
  lines.push(`updateDetected=${result.updateDetected}`);
  lines.push(`changeReasons=${result.changeReasons.join(",") || "none"}`);
  lines.push(`routeCount=${result.snapshot.routeCount}`);
  lines.push(`ethFamilyRouteCount=${result.ethFamily?.routeCount || 0}`);
  lines.push(`chains=${result.snapshot.chains.join(",")}`);
  lines.push(`routeHash=${result.snapshot.routeHash}`);
  lines.push(`schemaHash=${result.schemaHash}`);
  lines.push(`probeHealthHash=${result.probeHealthHash}`);
  lines.push(`openApiHash=${result.openApiSnapshot?.sha256 || "unavailable"}`);
  lines.push(`addedRoutes=${result.diff.addedRoutes.length}`);
  lines.push(`removedRoutes=${result.diff.removedRoutes.length}`);
  lines.push(`addedEthFamilyRoutes=${result.diff.addedEthFamilyRoutes.length}`);
  lines.push(`removedEthFamilyRoutes=${result.diff.removedEthFamilyRoutes.length}`);
  lines.push(`addedChains=${result.diff.addedChains.join(",") || "none"}`);
  lines.push(`removedChains=${result.diff.removedChains.join(",") || "none"}`);
  lines.push(`probeOk=${result.probes.filter((probe) => probe.ok).length}/${result.probes.length}`);
  lines.push(`probeFailures=${result.probeFailures.length}`);

  if (result.diff.addedRoutes.length > 0) {
    lines.push("");
    lines.push("--- Scan recommendations for new routes ---");
    const routeArgs = result.diff.addedRoutes.slice(0, 10).map((rk) => `--route-key="${rk}"`);
    for (const arg of routeArgs) {
      lines.push(`  npm run scan:quote-surface -- ${arg}`);
    }
    if (result.diff.addedRoutes.length > 10) {
      lines.push(`  ... and ${result.diff.addedRoutes.length - 10} more`);
    }
  }

  if (result.diff.addedEthFamilyRoutes.length > 0 || result.diff.removedEthFamilyRoutes.length > 0) {
    lines.push("");
    lines.push("--- ETH-family follow-up ---");
    for (const routeKey of result.diff.addedEthFamilyRoutes.slice(0, 10)) {
      lines.push(`  npm run scan:quote-surface -- --route-key="${routeKey}"`);
    }
    lines.push("  npm run analyze:ethereum-routes -- --write");
    lines.push("  npm run audit:eth-family-overfit");
  }

  return lines.join("\n");
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
    previousOpenApiSnapshot: previousRecord?.openApiSnapshot || null,
    evmRecipient: config.verifyRecipient,
    btcRecipient: config.verifyBtcRecipient,
  });

  await store.append("gateway-update-snapshots", result);
  if (result.openApiSnapshot?.sha256) {
    const snapshotPath = join(config.dataDir, "gateway", "openapi-snapshot.json");
    await mkdir(dirname(snapshotPath), { recursive: true });
    let previousOpenApiFile = null;
    try {
      previousOpenApiFile = JSON.parse(await readFile(snapshotPath, "utf8"));
    } catch {
      previousOpenApiFile = null;
    }
    const previousSnapshots = Array.isArray(previousOpenApiFile?.snapshots) ? previousOpenApiFile.snapshots : [];
    const nextSnapshot = {
      fetchedAt: result.openApiSnapshot.fetchedAt,
      url: result.openApiSnapshot.url,
      sha256: result.openApiSnapshot.sha256,
      bytes: result.openApiSnapshot.bytes,
      contentType: result.openApiSnapshot.contentType,
    };
    const snapshots =
      previousSnapshots.at(-1)?.sha256 === nextSnapshot.sha256
        ? previousSnapshots
        : [...previousSnapshots, nextSnapshot];
    await writeFile(
      snapshotPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          updatedAt: result.observedAt,
          snapshots,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }
  if (result.updateDetected) {
    await store.append("gateway-update-alerts", buildGatewayUpdateAlertRecord(result));
    const telegramResult = await sendTelegramMessage({
      botToken: config.telegramBotToken,
      chatId: config.telegramChatId,
      text: formatGatewayUpdateAlert(result),
      category: "gateway_update",
    });
    console.log(`telegram=${telegramResult.sent ? "sent" : `skipped:${telegramResult.reason}`}`);
  }

  console.log(summarizeResult(result));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
