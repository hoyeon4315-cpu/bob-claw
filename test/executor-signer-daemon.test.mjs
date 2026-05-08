import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildStrategyCapState } from "../src/executor/policy/cap-check.mjs";
import { handleIntentCommand, parseArgs } from "../src/executor/signer/daemon.mjs";

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

test("signer daemon redacts raw signed transaction bytes from successful client responses", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-signer-daemon-redact-"));
  const killSwitchPath = join(root, "KILL_SWITCH");
  const signed = {
    txHash: "0x" + "2".repeat(64),
    chain: "base",
    signedTx: "0xfeedface",
    metadata: {
      nonce: 8,
      from: "0x0000000000000000000000000000000000000002",
      to: "0x0000000000000000000000000000000000000001",
    },
  };
  const fakeSigner = {
    signIntent: async () => signed,
    broadcastSignedIntent: async () => ({ txHash: signed.txHash }),
  };

  try {
    for (const command of ["sign_only", "sign_and_broadcast"]) {
      const result = await handleIntentCommand({
        message: {
          command,
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

      assert.equal(result.status, "ok");
      assert.equal(result.signed.txHash, signed.txHash);
      assert.equal(result.signed.signedTx, undefined);
      assert.equal(result.signed.redacted, true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("signer daemon ignores runtime env active budget overrides", () => {
  const previous = process.env.BOB_CLAW_ACTIVE_BUDGET_USD;
  process.env.BOB_CLAW_ACTIVE_BUDGET_USD = "999999";
  try {
    const args = parseArgs([]);
    assert.equal(args.activeBudgetUsd, null);
  } finally {
    if (previous === undefined) {
      delete process.env.BOB_CLAW_ACTIVE_BUDGET_USD;
    } else {
      process.env.BOB_CLAW_ACTIVE_BUDGET_USD = previous;
    }
  }
});

test("signer daemon injects runtime risk context into signer policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-signer-daemon-risk-"));
  const killSwitchPath = join(root, "KILL_SWITCH");
  let signCalled = false;
  const fakeSigner = {
    signIntent: async () => {
      signCalled = true;
      return { txHash: "0x" + "3".repeat(64), signedTx: "0xdeadbeef" };
    },
  };

  try {
    const result = await handleIntentCommand({
      message: {
        command: "sign_only",
        intent: {
          ...buildIntent(),
          amountUsd: 200,
          metadata: { skipAutoIngest: true, protocol: "yo" },
        },
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
      loadRuntimeRiskContextImpl: async () => ({
        totalOperatingCapitalUsd: 1_000,
        currentAllocations: {
          perStrategy: {},
          perChain: { base: 0.3 },
          perProtocol: { yo: 0.2 },
          bobL2DirectShare: 0,
        },
      }),
    });

    assert.equal(result.status, "rejected");
    assert.equal(signCalled, false);
    assert.ok(result.policy.blockers.includes("concentration_guard_reject_intent"));
    const concentration = result.policy.results.find((item) => item.policy === "concentration_guard");
    assert.equal(concentration.decision, "BLOCK");
    assert.equal(concentration.verdict.details.projectedAllocations.perChain.base, 0.5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("signer daemon lets metadata risk total override runtime total", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-signer-daemon-risk-total-"));
  const killSwitchPath = join(root, "KILL_SWITCH");
  let signCalled = false;
  const fakeSigner = {
    signIntent: async () => {
      signCalled = true;
      return { txHash: "0x" + "4".repeat(64), signedTx: "0xdeadbeef" };
    },
  };

  try {
    const result = await handleIntentCommand({
      message: {
        command: "sign_only",
        intent: {
          ...buildIntent(),
          strategyId: "gateway_native_asset_conversion_sleeve",
          amountUsd: 500,
          metadata: {
            skipAutoIngest: true,
            riskContext: {
              totalOperatingCapitalUsd: 2_000,
              currentAllocations: {
                perStrategy: {},
                perChain: {},
                perProtocol: {},
                bobL2DirectShare: 0,
              },
            },
          },
        },
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
      loadRuntimeRiskContextImpl: async () => ({
        totalOperatingCapitalUsd: 1_000,
        currentAllocations: {
          perStrategy: {},
          perChain: {},
          perProtocol: {},
          bobL2DirectShare: 0,
        },
      }),
    });

    assert.equal(result.status, "ok");
    assert.equal(signCalled, true);
    const concentration = result.policy.results.find((item) => item.policy === "concentration_guard");
    assert.equal(concentration.decision, "ALLOW");
    assert.equal(concentration.verdict.details.projectedAllocations.perChain.base, 0.25);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("signer daemon lets metadata per-chain allocation override runtime allocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-signer-daemon-risk-chain-"));
  const killSwitchPath = join(root, "KILL_SWITCH");
  let signCalled = false;
  const fakeSigner = {
    signIntent: async () => {
      signCalled = true;
      return { txHash: "0x" + "5".repeat(64), signedTx: "0xdeadbeef" };
    },
  };

  try {
    const result = await handleIntentCommand({
      message: {
        command: "sign_only",
        intent: {
          ...buildIntent(),
          amountUsd: 100,
          metadata: {
            skipAutoIngest: true,
            riskContext: {
              totalOperatingCapitalUsd: 1_000,
              currentAllocations: {
                perChain: { base: 0.1 },
              },
            },
          },
        },
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
      loadRuntimeRiskContextImpl: async () => ({
        totalOperatingCapitalUsd: 1_000,
        currentAllocations: {
          perStrategy: {},
          perChain: { base: 0.3, ethereum: 0.1 },
          perProtocol: {},
          bobL2DirectShare: 0,
        },
      }),
    });

    assert.equal(result.status, "ok");
    assert.equal(signCalled, true);
    const concentration = result.policy.results.find((item) => item.policy === "concentration_guard");
    assert.equal(concentration.decision, "ALLOW");
    assert.equal(concentration.verdict.details.projectedAllocations.perChain.base, 0.2);
    assert.equal(concentration.verdict.details.projectedAllocations.perChain.ethereum, 0.1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
