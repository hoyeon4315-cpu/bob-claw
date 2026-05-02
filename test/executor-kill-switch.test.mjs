import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendKillSwitchAuditRecord,
  buildKillSwitchAuditRecord,
  checkKillSwitch,
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
