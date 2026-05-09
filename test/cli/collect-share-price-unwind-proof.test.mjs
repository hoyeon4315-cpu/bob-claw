import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { runCollectSharePriceUnwindProofCli } from "../../src/cli/collect-share-price-unwind-proof.mjs";

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("share-price unwind proof collector writes deterministic TTL proofs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-share-proof-"));
  await writeFile(join(cwd, "noop"), "", "utf8");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(cwd, "data", "radar"), { recursive: true }));
  await writeFile(
    join(cwd, "data", "radar", "executable-candidates.jsonl"),
    `${JSON.stringify({
      candidateId: "merkl:op1",
      packetId: "merkl:op1",
      observedAt: "2026-05-09T00:00:00.000Z",
      chain: "base",
      protocolId: "morpho",
      opportunityId: "op1",
      amountUsd: 10,
    })}\n`,
    "utf8",
  );
  await writeJson(join(cwd, "data", "merkl-canary-queue.json"), {
    queue: [{
      opportunityId: "op1",
      chain: "base",
      protocolId: "morpho",
      mappedStrategyId: "gateway_native_asset_conversion_sleeve",
      protocolBindingPlan: {
        status: "binding_ready",
        bindingKind: "erc4626_vault_supply_withdraw",
        canaryActions: ["deposit_asset_for_shares", "withdraw_or_redeem_shares"],
      },
    }],
  });

  const result = await runCollectSharePriceUnwindProofCli(["--json"], {
    cwd,
    now: "2026-05-09T01:00:00.000Z",
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.collectedCount, 1);
  assert.equal(result.payload.records[0].proofTtlExpiresAt, "2026-05-10T01:00:00.000Z");

  const proofLines = (await readFile(join(cwd, "data", "share-price-unwind-proofs.jsonl"), "utf8"))
    .trim()
    .split("\n");
  assert.equal(proofLines.length, 1);
  const proof = JSON.parse(proofLines[0]);
  assert.equal(proof.candidateId, "merkl:op1");
  assert.equal(proof.roundTripStatus, "simulated_ok");
});
