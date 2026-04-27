import { scanProtocols } from "../src/strategy/protocol-discovery-scanner.mjs";

function todaySuffix() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

export async function planProtocolAutoPrs({
  opportunities = [],
  knownProtocols = new Set(),
  dryRun = false,
} = {}) {
  const discovered = scanProtocols(opportunities);
  const plans = [];

  for (const d of discovered) {
    if (knownProtocols.has(d.protocol)) continue;

    const branch = `auto/protocol-${d.protocol.toLowerCase()}-${todaySuffix()}`;
    const commit = `chore(protocol): add ${d.protocol} [auto-discovery]`;
    const body = [
      `## Auto-discovery proposal: ${d.protocol}`,
      `- Aggregated TVL: $${d.totalTvl.toLocaleString()}`,
      `- Distinct opportunities: ${d.distinctOpps}`,
      `- Audit verified: ${d.audited}`,
    ].join("\n");

    plans.push({ branch, commit, body, label: "auto-protocol", discovery: d });

    if (dryRun) {
      console.log(`[dry-run] protocol PR for ${d.protocol}`);
      console.log(`  branch: ${branch}`);
      console.log(`  commit: ${commit}`);
    }
  }

  return plans;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  planProtocolAutoPrs({ opportunities: [], dryRun }).then((plans) => {
    if (!dryRun) console.log(JSON.stringify(plans, null, 2));
  });
}
