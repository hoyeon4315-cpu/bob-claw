import { scanChains } from "../src/strategy/chain-discovery-scanner.mjs";
import { listSupportedChains } from "../src/config/chains.mjs";

function todaySuffix() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function isAlreadyRegistered(chain) {
  return listSupportedChains().includes(String(chain).toLowerCase());
}

export async function planChainAutoPrs({
  opportunities = [],
  dryRun = false,
} = {}) {
  const discovered = scanChains(opportunities);
  const plans = [];

  for (const d of discovered) {
    if (isAlreadyRegistered(d.chain)) continue;

    const branch = `auto/chain-${d.chain.toLowerCase()}-${todaySuffix()}`;
    const commit = `chore(chain): add ${d.chain} [auto-discovery]`;
    const body = [
      `## Auto-discovery proposal: ${d.chain}`,
      `- LIVE opportunities: ${d.liveCount}`,
      `- Aggregated TVL: $${d.totalTvl.toLocaleString()}`,
      `- TIER_A/B opportunities: ${d.tierAB}`,
    ].join("\n");

    plans.push({ branch, commit, body, label: "auto-chain", discovery: d });

    if (dryRun) {
      console.log(`[dry-run] chain PR for ${d.chain}`);
      console.log(`  branch: ${branch}`);
      console.log(`  commit: ${commit}`);
    }
  }

  return plans;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  planChainAutoPrs({ opportunities: [], dryRun }).then((plans) => {
    if (!dryRun) console.log(JSON.stringify(plans, null, 2));
  });
}
