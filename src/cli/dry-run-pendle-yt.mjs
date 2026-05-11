#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { evaluatePendleYtEv, isPendleYtQueueItem } from "../strategy/pendle-yt-ev.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const entries = Object.fromEntries(
    argv
      .filter((a) => a.startsWith("--") && a.includes("="))
      .map((a) => {
        const i = a.indexOf("=");
        return [a.slice(2, i), a.slice(i + 1)];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    limit: entries.limit ? Number(entries.limit) : null,
    notionalOverride: entries.notional ? Number(entries.notional) : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const queue = JSON.parse(await readFile(join(config.dataDir, "merkl-canary-queue.json"), "utf8"));
  const pendleItems = (queue.queue || []).filter((q) => isPendleYtQueueItem(q));

  const results = pendleItems.map((item) => {
    const evInput = args.notionalOverride
      ? { ...item, tinyLivePerTxUsd: args.notionalOverride }
      : item;
    const ev = evaluatePendleYtEv(evInput, { now: new Date().toISOString() });
    const binding = item.protocolBindingPlan?.resolvedBinding || {};
    return {
      rank: item.rank,
      queueId: item.queueId,
      opportunityId: item.opportunityId,
      chain: item.chain,
      assetSymbol: binding.assetSymbol || item.name,
      bindingSource: binding.source || null,
      bindingStatus: item.protocolBindingPlan?.status || null,
      tvlUsd: item.tvlUsd ?? null,
      aprPct: item.aprPct ?? null,
      maturity: binding.maturity || null,
      ev,
      decision: ev?.canaryReady ? "candidate" : "blocked",
      blockers: ev?.blockers || [],
    };
  });

  results.sort((a, b) => {
    if (a.decision !== b.decision) return a.decision === "candidate" ? -1 : 1;
    return (b.aprPct ?? 0) - (a.aprPct ?? 0);
  });

  const limited = args.limit ? results.slice(0, args.limit) : results;
  const candidateCount = results.filter((r) => r.decision === "candidate").length;
  const blockerHistogram = {};
  for (const r of results) for (const b of r.blockers) blockerHistogram[b] = (blockerHistogram[b] || 0) + 1;

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceQueueGeneratedAt: queue.generatedAt || null,
    runtimeAuthority: "policy_engine_only",
    broadcastMode: "shadow_only_no_signer_dispatch",
    notionalOverrideUsd: args.notionalOverride,
    pendleYtItemCount: results.length,
    candidateCount,
    blockerHistogram,
    results: limited,
  };

  if (args.write) {
    await writeTextIfChanged(
      join(config.dataDir, "pendle-yt-dry-run-latest.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`pendleYtItemCount=${results.length}`);
  console.log(`candidateCount=${candidateCount}`);
  console.log(`blockerHistogram=${JSON.stringify(blockerHistogram)}`);
  for (const r of limited.slice(0, 10)) {
    console.log(
      `${r.rank} ${r.chain}/${r.assetSymbol} apr=${r.aprPct?.toFixed(2)}% expectedNet=${r.ev?.expectedNetUsd?.toFixed(3)} decision=${r.decision} blockers=${r.blockers.join(",")}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
