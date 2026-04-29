import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);

async function withTempRoot(fn) {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-report-auto-kill-"));
  try {
    await mkdir(join(dir, "data", "risk"), { recursive: true });
    await mkdir(join(dir, "dashboard", "public"), { recursive: true });
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("report-auto-kill-events clears armedAt when the kill-switch file has been removed", async () => {
  await withTempRoot(async (rootDir) => {
    const scriptPath = join(process.cwd(), "src", "cli", "report-auto-kill-events.mjs");
    const eventsPath = join(rootDir, "data", "risk", "auto-kill-events.jsonl");
    const outPath = join(rootDir, "dashboard", "public", "auto-kill-events.json");
    const killSwitchPath = join(rootDir, "kill.switch");
    const evaluatedAt = new Date(Date.now() - 60_000).toISOString();
    await writeFile(
      eventsPath,
      `${JSON.stringify({
        schemaVersion: 1,
        evaluatedAt,
        triggers: [{ trigger: "oracle_divergence" }],
        killSwitchPath,
        alreadyArmed: false,
      })}\n`,
      "utf8",
    );

    await execFileAsync(process.execPath, [
      scriptPath,
      "--write",
      `--events-path=${eventsPath}`,
      `--out=${outPath}`,
    ], { cwd: rootDir });

    const payload = JSON.parse(await readFile(outPath, "utf8"));
    assert.equal(payload.summaryKind, "event_window_with_current_kill_switch_state");
    assert.equal(payload.killSwitchActive, false);
    assert.equal(payload.currentState, "running");
    assert.equal(payload.armedAt, null);
  });
});
