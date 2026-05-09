import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { runCli } from "../../src/cli/run-cold-start-canary.mjs";

const candidate = {
  candidateId: "c1",
  packetId: "p1",
  gateStatus: "executable",
  observedAt: "2026-05-09T01:00:00.000Z",
  executionPath: "base_native_evm",
  familyKey: "same_chain_stable_carry",
  chain: "base",
  sanctionsFlag: "clean",
  bridgeRouteSanctionsCheck: "clean",
  killSwitchState: "running",
  proposedSizeBtc: 0.0001,
  committedCapBtc: 0.0002,
  amountUsd: 20,
  displayedAprPct: 500,
  expectedHoldDays: 30,
};

async function makeColdStartFixture({ withProof = false } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-cold-start-proof-"));
  await mkdir(join(cwd, "data", "radar"), { recursive: true });
  await mkdir(join(cwd, "logs"), { recursive: true });
  await writeFile(join(cwd, "data", "radar", "portable-packets.jsonl"), `${JSON.stringify({ packetId: "p1" })}\n`, "utf8");
  await writeFile(join(cwd, "data", "radar", "executable-candidates.jsonl"), `${JSON.stringify(candidate)}\n`, "utf8");
  if (withProof) {
    await writeFile(
      join(cwd, "data", "share-price-unwind-proofs.jsonl"),
      `${JSON.stringify({
        schemaVersion: 1,
        candidateId: "c1",
        strategyId: "stablecoin_spread_loop",
        chain: "base",
        protocolId: "morpho",
        opportunityId: "op1",
        observedSharePriceBefore: 1,
        observedSharePriceAfter: 1,
        notionalUsd: 20,
        costUsd: 0.02,
        simulatedAt: "2026-05-09T01:00:00.000Z",
        proofTtlExpiresAt: "2026-05-10T01:00:00.000Z",
        proofSource: "protocol_binding_plan_simulation",
        roundTripStatus: "simulated_ok",
      })}\n`,
      "utf8",
    );
  }
  return cwd;
}

test("cold-start canary consumes share-price unwind proof records", async () => {
  const withoutProof = await runCli(["--preview", "--json"], {
    cwd: await makeColdStartFixture({ withProof: false }),
    now: "2026-05-09T01:05:00.000Z",
  });
  const blocked = JSON.parse(withoutProof.stdout);
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.blockers.includes("share_price_unwind_proof_missing"));

  const withProof = await runCli(["--preview", "--json"], {
    cwd: await makeColdStartFixture({ withProof: true }),
    now: "2026-05-09T01:05:00.000Z",
  });
  const ready = JSON.parse(withProof.stdout);
  assert.equal(ready.status, "ready");
  assert.equal(ready.selectedCandidate.candidateId, "c1");
  assert.equal(ready.selectedCandidate.sharePriceUnwindProof.ok, true);
});
