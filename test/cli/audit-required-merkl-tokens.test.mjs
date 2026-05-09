import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  buildRequiredMerklTokensAudit,
  runAuditRequiredMerklTokens,
} from "../../src/cli/audit-required-merkl-tokens.mjs";

function opportunity(overrides = {}) {
  return {
    decision: "candidate",
    opportunityId: overrides.opportunityId || "opp-1",
    chain: overrides.chain || "base",
    mappedStrategyId: "gateway_native_asset_conversion_sleeve",
    entryTokenSymbols: overrides.entryTokenSymbols || ["USDC"],
    rewardTokenSymbols: overrides.rewardTokenSymbols || [],
    tokenDetails: overrides.tokenDetails || [
      {
        symbol: "USDC",
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals: 6,
        verified: true,
        type: "TOKEN",
      },
    ],
    protocolBinding: overrides.protocolBinding || null,
  };
}

test("required Merkl token audit separates committed allowlist entries from pending and unsafe tokens", () => {
  const audit = buildRequiredMerklTokensAudit({
    opportunities: [
      opportunity(),
      opportunity({
        opportunityId: "sei-usdc",
        chain: "sei",
        entryTokenSymbols: ["USDC"],
        tokenDetails: [
          {
            symbol: "USDC",
            address: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
            decimals: 6,
            verified: true,
            type: "TOKEN",
          },
        ],
      }),
      opportunity({
        opportunityId: "points",
        entryTokenSymbols: ["BOBPOINTS"],
        tokenDetails: [
          {
            symbol: "BOBPOINTS",
            address: "0x1111111111111111111111111111111111111111",
            decimals: 18,
            verified: false,
            type: "POINT",
          },
        ],
      }),
    ],
  }, { generatedAt: "2026-05-09T00:00:00.000Z" });

  const baseUsdc = audit.required.find((item) => item.sourceOpportunityIds.includes("opp-1"));
  assert.equal(baseUsdc.allowlistEligible, true);
  assert.equal(baseUsdc.classification, "registry_known_allowed");

  const seiUsdc = audit.required.find((item) => item.sourceOpportunityIds.includes("sei-usdc"));
  assert.equal(seiUsdc.allowlistEligible, false);
  assert.equal(seiUsdc.classification, "pending_new_address_manual_review");

  const points = audit.required.find((item) => item.sourceOpportunityIds.includes("points"));
  assert.equal(points.allowlistEligible, false);
  assert.equal(points.classification, "unsafe_governance_or_points");
  assert.equal(audit.summary.pendingCount, 1);
  assert.equal(audit.summary.unsafeCount, 1);
});

test("required Merkl token CLI writes audit JSON and pending whitelist without auto-adding new tokens", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-merkl-token-audit-"));
  const input = join(cwd, "report.json");
  const out = join(cwd, "audit.json");
  const pendingPath = join(cwd, "treasury", "pending-whitelist.jsonl");
  await writeFile(input, JSON.stringify({
    opportunities: [
      opportunity(),
      opportunity({
        opportunityId: "sei-usdc",
        chain: "sei",
        entryTokenSymbols: ["USDC"],
        tokenDetails: [
          {
            symbol: "USDC",
            address: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
            decimals: 6,
            verified: true,
            type: "TOKEN",
          },
        ],
      }),
    ],
  }), "utf8");

  const audit = await runAuditRequiredMerklTokens({
    input,
    out,
    pendingPath,
    write: true,
    writePending: true,
  });
  assert.equal(audit.summary.allowlistEligibleCount, 1);
  assert.equal(audit.summary.pendingCount, 1);

  const written = JSON.parse(await readFile(out, "utf8"));
  assert.equal(written.summary.requiredCount, 2);
  const pendingLines = (await readFile(pendingPath, "utf8")).trim().split("\n");
  assert.equal(pendingLines.length, 1);
  const pending = JSON.parse(pendingLines[0]);
  assert.equal(pending.source, "merkl_required_tokens_audit");
  assert.equal(pending.classification, "pending_new_address_manual_review");
});
