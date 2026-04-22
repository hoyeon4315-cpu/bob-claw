#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { MERKL_OPPORTUNITY_POLICY } from "../config/merkl-opportunity-policy.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildMerklOpportunityReport } from "../strategy/merkl-opportunity-plan.mjs";
import { fetchMerklUniverse } from "../watch/merkl-opportunity-watch.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const entries = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const index = item.indexOf("=");
        return [item.slice(2, index), item.slice(index + 1)];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    opportunityPages: Number(entries["opportunity-pages"] || MERKL_OPPORTUNITY_POLICY.api.maxOpportunityPages),
    campaignPages: Number(entries["campaign-pages"] || MERKL_OPPORTUNITY_POLICY.api.maxCampaignPages),
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const universe = await fetchMerklUniverse({
    apiBase: config.merklApiBase,
    opportunityPageSize: MERKL_OPPORTUNITY_POLICY.api.opportunityPageSize,
    campaignPageSize: MERKL_OPPORTUNITY_POLICY.api.campaignPageSize,
    maxOpportunityPages: args.opportunityPages,
    maxCampaignPages: args.campaignPages,
    timeoutMs: MERKL_OPPORTUNITY_POLICY.api.requestTimeoutMs,
  });

  const report = buildMerklOpportunityReport({
    opportunities: universe.opportunities,
    campaigns: universe.campaigns,
  });

  if (args.write) {
    await writeTextIfChanged(join(config.dataDir, "merkl-opportunities-report.json"), `${JSON.stringify(report, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`opportunityCount=${report.summary.opportunityCount}`);
  console.log(`campaignCount=${report.summary.campaignCount}`);
  console.log(`btcRelevantCount=${report.summary.btcRelevantCount}`);
  console.log(`candidateCount=${report.summary.candidateCount}`);
  console.log(`watchCount=${report.summary.watchCount}`);
  console.log(`blockedCount=${report.summary.blockedCount}`);
  console.log(`highOverfitRiskCount=${report.summary.highOverfitRiskCount}`);
  console.log(`rotationCandidateCount=${report.summary.rotationCandidateCount}`);
  console.log(`topCandidate=${report.summary.topCandidateId || "n/a"} strategy=${report.summary.topCandidateStrategyId || "n/a"}`);
  for (const item of report.topCandidates.slice(0, 5)) {
    console.log(
      `${item.opportunityId} ${item.chain}/${item.protocolId} family=${item.family} strategy=${item.mappedStrategyId || "n/a"} score=${item.score} remainingHours=${item.campaignRemainingHours ?? "n/a"}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
