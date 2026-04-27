import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planWhitelistAutoPrs } from "../scripts/whitelist-auto-pr.mjs";
import { planChainAutoPrs } from "../scripts/chain-add-auto-pr.mjs";
import { planProtocolAutoPrs } from "../scripts/protocol-add-auto-pr.mjs";

test("planWhitelistAutoPrs returns plans for qualifying candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-whitelist-apr-"));
  const path = join(root, "candidates.jsonl");
  await writeFile(
    path,
    JSON.stringify({ symbol: "NEWCOIN", contractAgeDays: 400, top10HolderPct: 30, hasAudit: true, vol30dPct: 20, tvlUsd: 20_000_000 }) + "\n" +
    JSON.stringify({ symbol: "BADCOIN", lockup: true, hasAudit: true, tvlUsd: 20_000_000 }) + "\n",
    "utf8"
  );
  const plans = await planWhitelistAutoPrs({ candidatesPath: path });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].proposal.id, "NEWCOIN");
  assert.ok(plans[0].branch.includes("auto/whitelist-newcoin-"));
  await rm(root, { recursive: true, force: true });
});

test("planWhitelistAutoPrs skips already whitelisted", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-whitelist-apr-"));
  const path = join(root, "candidates.jsonl");
  await writeFile(
    path,
    JSON.stringify({ symbol: "USDC", contractAgeDays: 400, top10HolderPct: 30, hasAudit: true, vol30dPct: 20, tvlUsd: 20_000_000 }) + "\n",
    "utf8"
  );
  const plans = await planWhitelistAutoPrs({ candidatesPath: path });
  assert.equal(plans.length, 0);
  await rm(root, { recursive: true, force: true });
});

test("planChainAutoPrs returns plans for qualifying chains", async () => {
  const opportunities = Array.from({ length: 5 }).map(() => ({
    chain: "nova",
    status: "LIVE",
    tvlUsd: 500_000,
    hasAudit: true,
    contractAgeDays: 400,
    top10HolderPct: 30,
    vol30dPct: 20,
  }));
  const plans = await planChainAutoPrs({ opportunities });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].discovery.chain, "nova");
  assert.ok(plans[0].branch.includes("auto/chain-nova-"));
});

test("planChainAutoPrs skips already registered chains", async () => {
  const opportunities = Array.from({ length: 5 }).map(() => ({
    chain: "base",
    status: "LIVE",
    tvlUsd: 500_000,
    hasAudit: true,
    contractAgeDays: 400,
    top10HolderPct: 30,
    vol30dPct: 20,
  }));
  const plans = await planChainAutoPrs({ opportunities });
  assert.equal(plans.length, 0);
});

test("planProtocolAutoPrs returns plans for qualifying protocols", async () => {
  const opportunities = [
    { protocol: "newproto", opportunityId: "a1", tvlUsd: 400_000, hasAudit: true },
    { protocol: "newproto", opportunityId: "a2", tvlUsd: 400_000, hasAudit: true },
    { protocol: "newproto", opportunityId: "a3", tvlUsd: 400_000, hasAudit: true },
  ];
  const plans = await planProtocolAutoPrs({ opportunities, knownProtocols: new Set() });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].discovery.protocol, "newproto");
});

test("planProtocolAutoPrs skips known protocols", async () => {
  const opportunities = [
    { protocol: "morpho", opportunityId: "a1", tvlUsd: 400_000, hasAudit: true },
    { protocol: "morpho", opportunityId: "a2", tvlUsd: 400_000, hasAudit: true },
    { protocol: "morpho", opportunityId: "a3", tvlUsd: 400_000, hasAudit: true },
  ];
  const plans = await planProtocolAutoPrs({ opportunities, knownProtocols: new Set(["morpho"]) });
  assert.equal(plans.length, 0);
});
