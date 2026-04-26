#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { MERKL_OPPORTUNITY_POLICY } from "../config/merkl-opportunity-policy.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { sendTelegramMessage } from "../notify/telegram.mjs";
import { buildMerklOpportunityReport } from "../strategy/merkl-opportunity-plan.mjs";
import { runMerklOpportunityWatch } from "../watch/merkl-opportunity-watch.mjs";

function formatAlert(result, report) {
  const top = report.topCandidates[0] || null;
  const lines = [
    "BOB Claw Merkl watcher",
    `observedAt: ${result.observedAt}`,
    `updateDetected: ${result.updateDetected}`,
    `added: ${result.diff.addedOpportunityIds.length}`,
    `removed: ${result.diff.removedOpportunityIds.length}`,
    `newlyLive: ${result.diff.newlyLiveIds.length}`,
    `ended: ${result.diff.endedIds.length}`,
    `newlyExpiring: ${result.diff.newlyExpiringIds.length}`,
    `candidateCount: ${report.summary.candidateCount}`,
    `multiAssetRelevantCount: ${report.summary.multiAssetRelevantCount}`,
    `highOverfitRiskCount: ${report.summary.highOverfitRiskCount}`,
  ];
  if (top) {
    lines.push(`topCandidate: ${top.chain}/${top.protocolId} ${top.name}`);
    lines.push(`strategy: ${top.mappedStrategyId || "n/a"} score=${top.score} mode=${top.validationMode}`);
  }
  return lines.join("\n");
}

function buildSnapshotRecord(result, report) {
  return {
    observedAt: result.observedAt,
    snapshot: result.snapshot,
    reportSummary: report.summary,
    topCandidateId: report.summary.topCandidateId,
    topCandidateStrategyId: report.summary.topCandidateStrategyId,
  };
}

async function main() {
  const previousRecords = await readJsonl(config.dataDir, "merkl-opportunity-snapshots");
  const previousRecord = previousRecords.at(-1) || null;
  const result = await runMerklOpportunityWatch({
    apiBase: config.merklApiBase,
    opportunityPageSize: MERKL_OPPORTUNITY_POLICY.api.opportunityPageSize,
    campaignPageSize: MERKL_OPPORTUNITY_POLICY.api.campaignPageSize,
    maxOpportunityPages: MERKL_OPPORTUNITY_POLICY.api.maxOpportunityPages,
    maxCampaignPages: MERKL_OPPORTUNITY_POLICY.api.maxCampaignPages,
    timeoutMs: MERKL_OPPORTUNITY_POLICY.api.requestTimeoutMs,
    previousSnapshot: previousRecord?.snapshot || null,
  });
  const report = buildMerklOpportunityReport({
    opportunities: result.opportunities,
    campaigns: result.campaigns,
    now: result.observedAt,
  });
  const store = new JsonlStore(config.dataDir);
  await store.append("merkl-opportunity-snapshots", buildSnapshotRecord(result, report));

  if (result.updateDetected) {
    const alert = {
      observedAt: result.observedAt,
      diff: result.diff,
      reportSummary: report.summary,
      topCandidate: report.topCandidates[0] || null,
      rotationPlan: report.rotationPlan.slice(0, 5),
    };
    await store.append("merkl-opportunity-alerts", alert);
    const telegramResult = await sendTelegramMessage({
      botToken: config.telegramBotToken,
      chatId: config.telegramChatId,
      text: formatAlert(result, report),
      category: "merkl_opportunity",
    });
    console.log(`telegram=${telegramResult.sent ? "sent" : `skipped:${telegramResult.reason}`}`);
  }

  console.log(`updateDetected=${result.updateDetected}`);
  console.log(`opportunityCount=${result.snapshot.opportunityCount}`);
  console.log(`campaignCount=${result.snapshot.campaignCount}`);
  console.log(`expiringSoonCount=${result.snapshot.expiringSoonCount}`);
  console.log(`multiAssetRelevantCount=${report.summary.multiAssetRelevantCount}`);
  console.log(`candidateCount=${report.summary.candidateCount}`);
  console.log(`watchCount=${report.summary.watchCount}`);
  console.log(`blockedCount=${report.summary.blockedCount}`);
  console.log(`highOverfitRiskCount=${report.summary.highOverfitRiskCount}`);
  console.log(`topCandidate=${report.summary.topCandidateId || "n/a"} strategy=${report.summary.topCandidateStrategyId || "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
