import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildStrategyCapState } from "../src/executor/policy/cap-check.mjs";
import { handleIntentCommand } from "../src/executor/signer/daemon.mjs";

function buildIntent() {
  return {
    strategyId: "across-bridge",
    chain: "base",
    family: "evm",
    intentType: "swap",
    amountUsd: 1,
    expectedNetUsd: 10,
    mode: "live",
    observedAt: new Date().toISOString(),
    tx: {
      to: "0x0000000000000000000000000000000000000001",
      data: "0x",
      value: "0",
      gasLimit: "21000",
    },
    metadata: {
      skipAutoIngest: true,
    },
  };
}

test("signer daemon rechecks kill-switch after signing and before broadcast", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-signer-daemon-"));
  const killSwitchPath = join(root, "KILL_SWITCH");
  let broadcastCalled = false;
  const signed = {
    txHash: "0x" + "1".repeat(64),
    chain: "base",
    signedTx: "0xdeadbeef",
    metadata: {
      nonce: 7,
      from: "0x0000000000000000000000000000000000000002",
      to: "0x0000000000000000000000000000000000000001",
    },
  };
  const fakeSigner = {
    signIntent: async () => {
      await writeFile(killSwitchPath, "halt\n", "utf8");
      return signed;
    },
    broadcastSignedIntent: async () => {
      broadcastCalled = true;
      return { txHash: signed.txHash };
    },
  };

  try {
    const result = await handleIntentCommand({
      message: {
        command: "sign_and_broadcast",
        intent: buildIntent(),
      },
      signers: {
        evm: fakeSigner,
      },
      args: {
        activeBudgetUsd: null,
        killSwitchPath,
        autoIngest: false,
      },
      cwd: root,
      transactionNotifyImpl: async () => ({ sent: true }),
    });

    assert.equal(result.status, "rejected");
    assert.equal(broadcastCalled, false);
    assert.ok(result.policy.blockers.includes("kill_switch_present"));
    assert.equal(result.signed.txHash, signed.txHash);
    assert.equal(result.signed.signedTx, undefined);
    const auditLines = (await readFile(join(root, "logs", "signer-audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const capState = buildStrategyCapState({
      strategyId: "across-bridge",
      auditRecords: auditLines,
      now: new Date().toISOString(),
    });
    assert.equal(capState.dailyVolumeUsd, 0);
    assert.equal(auditLines.at(-1).policyVerdict, "rejected");
    assert.equal(auditLines.at(-1).lifecycle.stage, "rejected");
    assert.deepEqual(auditLines.at(-1).lifecycle.blockers, ["kill_switch_present"]);
    assert.equal(auditLines.at(-1).broadcast, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
