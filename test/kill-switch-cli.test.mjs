import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);

test("kill-switch resume review CLI appends audit packet without clearing the kill-switch", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-kill-resume-review-"));
  try {
    const killSwitchPath = join(root, "KILL_SWITCH");
    const auditPath = join(root, "kill-switch-audit.jsonl");
    const dashboardPath = join(root, "dashboard-status.json");
    const postmortemPath = join(root, "parcel-16.md");
    const trigger = {
      trigger: "failure_burst_per_strategy",
      strategyId: "gateway-btc-funding-transfer",
      failureCount: 6,
      threshold: 5,
      windowMs: 300000,
    };
    await writeFile(killSwitchPath, JSON.stringify({
      schemaVersion: 1,
      evaluatedAt: "2026-05-04T18:16:45.378Z",
      reason: "auto_kill:failure_burst_per_strategy",
      actor: "risk:auto-kill",
      triggers: [trigger],
    }), "utf8");
    await writeFile(auditPath, `${JSON.stringify({
      ts: "2026-05-04T18:16:45.378Z",
      action: "halt",
      reason: "auto_kill:failure_burst_per_strategy",
      actor: "risk:auto-kill",
      killSwitchPath,
      previousState: "running",
    })}\n`, "utf8");
    await writeFile(dashboardPath, JSON.stringify({
      executorRuntime: {
        killSwitch: {
          killSwitchPath,
          replay: {
            triggered: false,
            staleArm: true,
            triggers: [],
          },
        },
      },
      capitalSummary: { totalUsd: 500 },
    }), "utf8");
    await writeFile(postmortemPath, "# postmortem\n", "utf8");

    const { stdout } = await execFileAsync("node", [
      "src/cli/run-kill-switch.mjs",
      "--resume-review",
      "--json",
      `--kill-switch-path=${killSwitchPath}`,
      `--audit-path=${auditPath}`,
      `--dashboard-path=${dashboardPath}`,
      `--postmortem-path=${postmortemPath}`,
    ], { cwd: process.cwd() });

    const packet = JSON.parse(stdout);
    assert.equal(packet.state, "HALTED");
    assert.equal(packet.clearsKillSwitch, false);
    assert.equal(packet.checklist.find((item) => item.id === "postmortem_written").answer, "yes");
    await access(killSwitchPath);

    const auditLines = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(auditLines.at(-1).action, "resume_review_packet");
    assert.equal(auditLines.at(-1).previousState, "halted");
    assert.equal(auditLines.at(-1).metadata.activeReason, "auto_kill:failure_burst_per_strategy");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
