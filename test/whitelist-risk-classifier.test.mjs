import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyWhitelistRisk } from "../src/strategy/whitelist-risk-classifier.mjs";
import { scanWhitelistCandidates } from "../src/strategy/whitelist-candidate-scanner.mjs";
import { buildWhitelistProposal, buildWhitelistProposals } from "../src/strategy/whitelist-proposal-builder.mjs";

test("classifyWhitelistRisk REJECT on lockup", () => {
  const result = classifyWhitelistRisk({ lockup: true, hasAudit: true, tvlUsd: 20_000_000 });
  assert.equal(result.tier, "REJECT");
  assert.ok(result.blockers.includes("lockup_true"));
});

test("classifyWhitelistRisk REJECT on non-transferable", () => {
  const result = classifyWhitelistRisk({ transferable: false, hasAudit: true, tvlUsd: 20_000_000 });
  assert.equal(result.tier, "REJECT");
  assert.ok(result.blockers.includes("transferable_false"));
});

test("classifyWhitelistRisk REJECT on no audit and low tvl", () => {
  const result = classifyWhitelistRisk({ hasAudit: false, tvlUsd: 5_000_000 });
  assert.equal(result.tier, "REJECT");
  assert.ok(result.blockers.includes("no_audit_and_low_tvl"));
});

test("classifyWhitelistRisk TIER_A", () => {
  const result = classifyWhitelistRisk({
    contractAgeDays: 400,
    top10HolderPct: 30,
    hasAudit: true,
    vol30dPct: 20,
    tvlUsd: 20_000_000,
  });
  assert.equal(result.tier, "TIER_A");
  assert.equal(result.blockers.length, 0);
});

test("classifyWhitelistRisk TIER_B via trusted issuer", () => {
  const result = classifyWhitelistRisk({
    trustedIssuer: "circle",
    transferable: true,
    hasAudit: true,
    tvlUsd: 10_000_000,
  });
  assert.equal(result.tier, "TIER_B");
  assert.equal(result.blockers.length, 0);
});

test("classifyWhitelistRisk TIER_C", () => {
  const result = classifyWhitelistRisk({
    contractAgeDays: 120,
    top10HolderPct: 50,
    hasAudit: true,
    vol30dPct: 60,
    tvlUsd: 20_000_000,
  });
  assert.equal(result.tier, "TIER_C");
  assert.equal(result.blockers.length, 0);
});

test("classifyWhitelistRisk REJECT otherwise", () => {
  const result = classifyWhitelistRisk({
    contractAgeDays: 10,
    top10HolderPct: 90,
    hasAudit: true,
    vol30dPct: 100,
    tvlUsd: 20_000_000,
  });
  assert.equal(result.tier, "REJECT");
});

test("scanWhitelistCandidates returns empty when file missing", async () => {
  const result = await scanWhitelistCandidates({ candidatesPath: "/nonexistent/path.jsonl" });
  assert.deepEqual(result, []);
});

test("scanWhitelistCandidates filters qualifying candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-whitelist-"));
  const path = join(root, "candidates.jsonl");
  await writeFile(
    path,
    JSON.stringify({ symbol: "GOOD", contractAgeDays: 400, top10HolderPct: 30, hasAudit: true, vol30dPct: 20, tvlUsd: 20_000_000 }) + "\n" +
    JSON.stringify({ symbol: "BAD", lockup: true, hasAudit: true, tvlUsd: 20_000_000 }) + "\n" +
    JSON.stringify({ symbol: "PROCESSED", contractAgeDays: 400, top10HolderPct: 30, hasAudit: true, vol30dPct: 20, tvlUsd: 20_000_000, processed: true }) + "\n",
    "utf8"
  );
  const result = await scanWhitelistCandidates({ candidatesPath: path });
  assert.equal(result.length, 1);
  assert.equal(result[0].symbol, "GOOD");
  assert.equal(result[0].classification.tier, "TIER_A");
  await rm(root, { recursive: true, force: true });
});

test("buildWhitelistProposal returns structured proposal", () => {
  const proposal = buildWhitelistProposal({
    symbol: "TEST",
    contractAgeDays: 400,
    top10HolderPct: 30,
    hasAudit: true,
    vol30dPct: 20,
    tvlUsd: 20_000_000,
  });
  assert.equal(proposal.entity, "whitelist");
  assert.equal(proposal.id, "TEST");
  assert.equal(proposal.tier, "TIER_A");
  assert.ok(proposal.idempotentCheck.includes("TEST"));
});

test("buildWhitelistProposals maps over array", () => {
  const proposals = buildWhitelistProposals([
    { symbol: "A", contractAgeDays: 400, top10HolderPct: 30, hasAudit: true, vol30dPct: 20, tvlUsd: 20_000_000 },
    { symbol: "B", lockup: true, hasAudit: true, tvlUsd: 20_000_000 },
  ]);
  assert.equal(proposals.length, 2);
  assert.equal(proposals[0].tier, "TIER_A");
  assert.equal(proposals[1].tier, "REJECT");
});
