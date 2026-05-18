import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendKillSwitchAuditRecord,
  buildKillSwitchAuditRecord,
  buildKillSwitchResumeReviewPacket,
  checkKillSwitch,
  parseKillSwitchFileContents,
  readKillSwitchStatus,
  readLatestKillSwitchAuditRecord,
  resolveKillSwitchAuditPath,
  resolveKillSwitchPath,
} from "../src/executor/policy/kill-switch.mjs";

test("resolveKillSwitchPath reads env configuration", () => {
  assert.equal(resolveKillSwitchPath({ KILL_SWITCH_PATH: "/tmp/bob.kill" }), "/tmp/bob.kill");
  assert.equal(resolveKillSwitchPath({ HOME: "/tmp/bob-home" }), "/tmp/bob-home/.bob-claw/KILL_SWITCH");
});

test("checkKillSwitch blocks when kill switch file exists", async () => {
  const result = await checkKillSwitch({
    killSwitchPath: "/tmp/bob.kill",
    existsImpl: async () => true,
    now: "2026-04-16T00:00:00.000Z",
  });

  assert.equal(result.decision, "BLOCK");
  assert.deepEqual(result.blockers, ["kill_switch_present"]);
});

test("checkKillSwitch allows when no kill switch file exists", async () => {
  const result = await checkKillSwitch({
    killSwitchPath: "/tmp/bob.kill",
    existsImpl: async () => false,
  });

  assert.equal(result.decision, "ALLOW");
  assert.deepEqual(result.blockers, []);
});

test("kill-switch audit helpers append jsonl records", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-kill-audit-"));
  try {
    const auditPath = join(root, "logs", "kill-switch-audit.jsonl");
    const record = buildKillSwitchAuditRecord({
      action: "halt",
      reason: "manual_test",
      actor: "operator-via-llm",
      killSwitchPath: join(root, "kill.switch"),
      previousState: "running",
      now: "2026-04-26T00:00:00.000Z",
      metadata: { source: "unit_test" },
    });
    const writtenPath = await appendKillSwitchAuditRecord(record, { auditPath });
    const written = await readFile(writtenPath, "utf8");
    const parsed = JSON.parse(written.trim());

    assert.equal(resolveKillSwitchAuditPath({ KILL_SWITCH_AUDIT_PATH: auditPath }), auditPath);
    assert.equal(parsed.action, "halt");
    assert.equal(parsed.reason, "manual_test");
    assert.equal(parsed.actor, "operator-via-llm");
    assert.equal(parsed.metadata.source, "unit_test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("kill-switch audit reader filters to the requested kill-switch path", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-kill-audit-filter-"));
  try {
    const auditPath = join(root, "logs", "kill-switch-audit.jsonl");
    const productionPath = join(root, "prod.kill");
    const testPath = join(root, "test.kill");
    await appendKillSwitchAuditRecord(
      buildKillSwitchAuditRecord({
        action: "halt",
        reason: "auto_kill:failure_burst_per_strategy",
        actor: "risk:auto-kill",
        killSwitchPath: productionPath,
        previousState: "running",
        now: "2026-05-04T18:16:45.378Z",
      }),
      { auditPath },
    );
    await appendKillSwitchAuditRecord(
      buildKillSwitchAuditRecord({
        action: "halt",
        reason: "watchdog_heartbeat_stale",
        actor: "executor:watchdog",
        killSwitchPath: testPath,
        previousState: "running",
        now: "2026-05-04T21:10:26.618Z",
      }),
      { auditPath },
    );

    const latest = await readLatestKillSwitchAuditRecord({
      auditPath,
      killSwitchPath: productionPath,
    });

    assert.equal(latest.killSwitchPath, productionPath);
    assert.equal(latest.reason, "auto_kill:failure_burst_per_strategy");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("kill-switch status reads current file payload and matching audit reason", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-kill-status-"));
  try {
    const killSwitchPath = join(root, "KILL_SWITCH");
    const auditPath = join(root, "logs", "kill-switch-audit.jsonl");
    await writeFile(
      killSwitchPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          evaluatedAt: "2026-05-04T18:16:45.378Z",
          triggers: [
            {
              trigger: "failure_burst_per_strategy",
              strategyId: "gateway-btc-funding-transfer",
              failureCount: 6,
              threshold: 5,
              windowMs: 300000,
            },
          ],
          killSwitchPath,
          alreadyArmed: false,
        },
        null,
        2,
      ),
    );
    await appendKillSwitchAuditRecord(
      buildKillSwitchAuditRecord({
        action: "halt",
        reason: "auto_kill:failure_burst_per_strategy",
        actor: "risk:auto-kill",
        killSwitchPath,
        previousState: "running",
        now: "2026-05-04T18:16:45.378Z",
      }),
      { auditPath },
    );
    await appendKillSwitchAuditRecord(
      buildKillSwitchAuditRecord({
        action: "halt",
        reason: "watchdog_heartbeat_stale",
        actor: "executor:watchdog",
        killSwitchPath: join(root, "TEST_ONLY.kill"),
        previousState: "running",
        now: "2026-05-04T21:10:26.618Z",
      }),
      { auditPath },
    );

    const status = await readKillSwitchStatus({ killSwitchPath, auditPath });

    assert.equal(status.halted, true);
    assert.equal(status.activeReason, "auto_kill:failure_burst_per_strategy");
    assert.equal(status.activeActor, "risk:auto-kill");
    assert.equal(status.triggers.length, 1);
    assert.equal(status.lastAudit.reason, "auto_kill:failure_burst_per_strategy");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("kill-switch status includes dashboard replay only for the matching kill-switch path", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-kill-status-replay-"));
  try {
    const killSwitchPath = join(root, "KILL_SWITCH");
    const auditPath = join(root, "logs", "kill-switch-audit.jsonl");
    await writeFile(killSwitchPath, "halted_at=2026-05-05T00:00:00.000Z\nreason=manual\nactor=operator\n");
    await appendKillSwitchAuditRecord(
      buildKillSwitchAuditRecord({
        action: "halt",
        reason: "manual",
        actor: "operator",
        killSwitchPath,
        previousState: "running",
        now: "2026-05-05T00:00:00.000Z",
      }),
      { auditPath },
    );

    const replay = { triggered: false, staleArm: true };
    const status = await readKillSwitchStatus({
      killSwitchPath,
      auditPath,
      dashboardStatus: {
        executorRuntime: {
          killSwitch: {
            killSwitchPath,
            replay,
          },
        },
      },
    });
    const mismatched = await readKillSwitchStatus({
      killSwitchPath,
      auditPath,
      dashboardStatus: {
        executorRuntime: {
          killSwitch: {
            killSwitchPath: join(root, "OTHER_KILL_SWITCH"),
            replay,
          },
        },
      },
    });

    assert.deepEqual(status.replay, replay);
    assert.equal(mismatched.replay, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("kill-switch status ignores dashboard replay when the kill-switch is not armed", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-kill-status-running-replay-"));
  try {
    const killSwitchPath = join(root, "KILL_SWITCH");
    const auditPath = join(root, "logs", "kill-switch-audit.jsonl");
    const replay = {
      triggered: true,
      triggers: [{ trigger: "relative_price_stale" }],
    };

    const status = await readKillSwitchStatus({
      killSwitchPath,
      auditPath,
      dashboardStatus: {
        executorRuntime: {
          killSwitch: {
            killSwitchPath,
            replay,
          },
        },
      },
    });

    assert.equal(status.halted, false);
    assert.equal(status.replay, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("kill-switch status does not let resume review packets replace the active halt reason", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-kill-status-review-audit-"));
  try {
    const killSwitchPath = join(root, "KILL_SWITCH");
    const auditPath = join(root, "logs", "kill-switch-audit.jsonl");
    await writeFile(
      killSwitchPath,
      JSON.stringify({
        schemaVersion: 1,
        evaluatedAt: "2026-05-04T18:16:45.378Z",
      }),
      "utf8",
    );
    await appendKillSwitchAuditRecord(
      buildKillSwitchAuditRecord({
        action: "halt",
        reason: "auto_kill:failure_burst_per_strategy",
        actor: "risk:auto-kill",
        killSwitchPath,
        previousState: "running",
        now: "2026-05-04T18:16:45.378Z",
      }),
      { auditPath },
    );
    await appendKillSwitchAuditRecord(
      buildKillSwitchAuditRecord({
        action: "resume_review_packet",
        reason: "operator_resume_review",
        actor: "operator-via-llm",
        killSwitchPath,
        previousState: "halted",
        now: "2026-05-05T06:00:00.000Z",
      }),
      { auditPath },
    );

    const status = await readKillSwitchStatus({ killSwitchPath, auditPath });

    assert.equal(status.activeReason, "auto_kill:failure_burst_per_strategy");
    assert.equal(status.activeActor, "risk:auto-kill");
    assert.equal(status.lastAudit.action, "resume_review_packet");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("kill-switch parser handles operator key-value payloads", () => {
  const parsed = parseKillSwitchFileContents(
    "halted_at=2026-05-05T00:00:00.000Z\nreason=manual halt\nactor=operator-via-llm\n",
  );
  assert.equal(parsed.halted_at, "2026-05-05T00:00:00.000Z");
  assert.equal(parsed.reason, "manual halt");
  assert.equal(parsed.actor, "operator-via-llm");
});

test("resume review packet keeps operator checklist explicit and non-mutating", () => {
  const packet = buildKillSwitchResumeReviewPacket({
    status: {
      halted: true,
      killSwitchPath: "/tmp/KILL_SWITCH",
      activeReason: "auto_kill:failure_burst_per_strategy",
      activeSince: "2026-05-04T18:16:45.378Z",
      triggers: [
        {
          trigger: "failure_burst_per_strategy",
          strategyId: "gateway-btc-funding-transfer",
          failureCount: 6,
          threshold: 5,
          windowMs: 300000,
        },
      ],
    },
    replay: {
      triggered: false,
      staleArm: true,
    },
    postmortemPath: "docs/research/parcel-16-gateway-btc-funding-postmortem.md",
    postmortemExists: true,
    now: "2026-05-05T06:00:00.000Z",
  });

  assert.equal(packet.state, "HALTED");
  assert.equal(packet.activeReason, "auto_kill:failure_burst_per_strategy");
  assert.equal(packet.checklist.find((item) => item.id === "inventory_restored").answer, "no");
  assert.equal(packet.checklist.find((item) => item.id === "postmortem_written").answer, "yes");
  assert.equal(packet.checklist.find((item) => item.id === "blocker_mitigated").answer, "yes");
  assert.equal(packet.nextAction, "operator_may_review_resume_command");
  assert.equal(packet.clearsKillSwitch, false);
});

test("readKillSwitchStatus auto-clears stale watchdog arm (temp file repro: file removed + audit appended + halted=false)", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-kill-stale-arm-"));
  try {
    const killSwitchPath = join(root, "KILL_SWITCH");
    const auditPath = join(root, "logs", "kill-switch-audit.jsonl");
    // content that triggers rawContentLooksLikeWatchdogTimestamp (no reason/actor/halted_at)
    await writeFile(killSwitchPath, "evaluatedAt=2026-05-16T12:00:00.000Z\n");
    const beforeExists = await (async () => {
      try {
        await readFile(killSwitchPath);
        return true;
      } catch {
        return false;
      }
    })();
    assert.equal(beforeExists, true, "pre: KILL_SWITCH file must exist");

    const status = await readKillSwitchStatus({ killSwitchPath, auditPath });

    assert.equal(status.halted, false, "returned status must be cleared (halted:false)");
    const afterExists = await (async () => {
      try {
        await readFile(killSwitchPath);
        return true;
      } catch {
        return false;
      }
    })();
    assert.equal(afterExists, false, "post: KILL_SWITCH file must actually be removed");
    const auditRaw = await readFile(auditPath, "utf8");
    const hasAutoClear = auditRaw.includes("auto_cleared_stale_arm");
    assert.equal(hasAutoClear, true, "audit trail must contain auto_cleared_stale_arm record");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
