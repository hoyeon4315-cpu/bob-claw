import { readFile } from "node:fs/promises";
import { scanWhitelistCandidates } from "../src/strategy/whitelist-candidate-scanner.mjs";
import { buildWhitelistProposal } from "../src/strategy/whitelist-proposal-builder.mjs";
import { MERKL_AUTO_ENTRY_POLICY } from "../src/config/merkl-auto-entry.mjs";

function todaySuffix() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function isAlreadyWhitelisted(symbol, policy = MERKL_AUTO_ENTRY_POLICY) {
  const set = new Set((policy.whitelistedEntrySymbols || []).map((s) => s.toUpperCase()));
  return set.has(String(symbol).toUpperCase());
}

export async function planWhitelistAutoPrs({
  candidatesPath = "data/whitelist-candidates.jsonl",
  dryRun = false,
} = {}) {
  const candidates = await scanWhitelistCandidates({ candidatesPath });
  const plans = [];

  for (const c of candidates) {
    const proposal = buildWhitelistProposal(c);
    if (proposal.tier === "REJECT") continue;
    if (isAlreadyWhitelisted(proposal.id)) continue;

    const branch = `auto/whitelist-${proposal.id.toLowerCase()}-${todaySuffix()}`;
    const commit = `chore(whitelist): add ${proposal.id} [auto-discovery]`;
    const body = [
      `## Auto-discovery proposal: ${proposal.id}`,
      `- Tier: ${proposal.tier}`,
      `- Evidence: ${JSON.stringify(proposal.evidence)}`,
      `- 14-day backward sim: pending`,
    ].join("\n");

    plans.push({ branch, commit, body, label: "auto-whitelist", proposal });

    if (dryRun) {
      console.log(`[dry-run] whitelist PR for ${proposal.id}`);
      console.log(`  branch: ${branch}`);
      console.log(`  commit: ${commit}`);
    }
  }

  return plans;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  planWhitelistAutoPrs({ dryRun }).then((plans) => {
    if (!dryRun) console.log(JSON.stringify(plans, null, 2));
  });
}
