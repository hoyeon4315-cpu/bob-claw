import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

async function withTempRoot(fn) {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-run-auto-kill-"));
  try {
    await mkdir(join(dir, "data"), { recursive: true });
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("run-auto-kill-check maps anchor health percentages into CL range trigger inputs", async () => {
  await withTempRoot(async (rootDir) => {
    await writeFile(
      join(rootDir, "data", "anchor-position-health.json"),
      `${JSON.stringify({
        positions: [
          {
            protocol: "aerodrome",
            chain: "base",
            tokenId: "123",
            timeInRange: 70,
          },
        ],
      })}\n`,
      "utf8",
    );

    const scriptPath = join(process.cwd(), "src", "cli", "run-auto-kill-check.mjs");
    const result = spawnSync(process.execPath, [
      scriptPath,
      "--json",
      `--kill-switch-path=${join(rootDir, "kill.switch")}`,
      "--cl-status-path=data/anchor-position-health.json",
    ], {
      cwd: rootDir,
      encoding: "utf8",
    });

    assert.equal(result.status, 2);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.triggered, true);
    assert.equal(payload.triggers[0].trigger, "cl_range_health");
    assert.equal(payload.triggers[0].timeInRangePct24h, 0.70);
    const killSwitch = JSON.parse(await readFile(join(rootDir, "kill.switch"), "utf8"));
    assert.equal(killSwitch.triggers[0].trigger, "cl_range_health");
  });
});
