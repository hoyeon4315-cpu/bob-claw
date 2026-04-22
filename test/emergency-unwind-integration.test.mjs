import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleIntentCommand } from "../src/executor/signer/daemon.mjs";
import { buildEmergencyUnwindIntent } from "../src/executor/policy/emergency-unwind-intent.mjs";

function createTempDir() {
  return mkdtempSync(join(tmpdir(), "emergency-unwind-test-"));
}

function mockSigner() {
  return {
    signIntent: async () => ({
      signedTx: "0xsigned",
      txHash: "0xemergencyunwind123",
    }),
    broadcastSignedIntent: async () => ({
      txHash: "0xemergencyunwind123",
    }),
    broadcastTransaction: async () => ({
      txHash: "0xemergencyunwind123",
      rawTx: "0xabc",
      nonce: 42,
    }),
    waitForTransaction: async () => ({
      status: 1,
      blockNumber: 12345,
      gasUsed: 100000,
      effectiveGasPrice: 1000000000,
    }),
  };
}

test("emergency_unwind intent end-to-end through policy, signer mock, receipt", async () => {
  const cwd = createTempDir();
  try {
    const intent = buildEmergencyUnwindIntent({
      strategyId: "wrapped-btc-loop-base-moonwell",
      chain: "base",
      family: "evm",
      emergencyUnwindPath: ["repay borrow asset", "withdraw collateral", "bridge or swap back to settlement path"],
      triggers: ["health_factor_below_min", "liquidation_buffer_breached"],
      positionState: { currentHealthFactor: 1.28, currentLiquidationBufferPct: 11 },
      metadata: { slippagePct: 0.5, realizedNetPnlBtc: -0.001 },
    });

    const result = await handleIntentCommand({
      message: {
        intent,
        command: "sign_and_broadcast",
        awaitConfirmation: true,
        confirmations: 1,
        timeoutMs: 30000,
      },
      signers: { evm: mockSigner() },
      args: {
        killSwitchPath: join(cwd, "kill.switch"),
        activeBudgetUsd: null,
      },
      cwd,
    });

    assert.equal(result.status, "ok");
    assert.equal(result.broadcast.txHash, "0xemergencyunwind123");

    const auditPath = join(cwd, "logs", "signer-audit.jsonl");
    const auditLines = readFileSync(auditPath, "utf8").trim().split("\n");
    assert.equal(auditLines.length, 3);
    const record = JSON.parse(auditLines[2]);
    assert.equal(record.intent.intentType, "emergency_unwind");
    assert.equal(record.policyVerdict, "approved");
    assert.equal(record.lifecycle.stage, "confirmed");
    assert.equal(record.lifecycle.txHash, "0xemergencyunwind123");
    assert.equal(record.intent.metadata.healthFactorPath, 1.28);
    assert.equal(record.intent.metadata.liquidationBufferPath, 11);
    assert.equal(record.realized.healthFactorPath, 1.28);
    assert.equal(record.realized.liquidationBufferPath, 11);
    assert.equal(record.realized.slippagePct, 0.5);
    assert.equal(record.realized.realizedNetPnlBtc, -0.001);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("emergency_unwind intent passes policy even when HF is healthy (proposer already decided)", async () => {
  const cwd = createTempDir();
  try {
    const intent = buildEmergencyUnwindIntent({
      strategyId: "wrapped-btc-loop-base-moonwell",
      chain: "base",
      family: "evm",
      emergencyUnwindPath: ["repay borrow asset", "withdraw collateral"],
      triggers: ["health_factor_below_min"],
      positionState: { currentHealthFactor: 1.5, currentLiquidationBufferPct: 15 },
    });

    const result = await handleIntentCommand({
      message: { intent, command: "sign_and_broadcast", awaitConfirmation: true, confirmations: 1, timeoutMs: 30000 },
      signers: { evm: mockSigner() },
      args: {
        killSwitchPath: join(cwd, "kill.switch"),
        activeBudgetUsd: null,
      },
      cwd,
    });

    assert.equal(result.status, "ok");
    assert.equal(result.policy.decision, "ALLOW");
    assert.equal(result.policy.requiresUnwind, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
