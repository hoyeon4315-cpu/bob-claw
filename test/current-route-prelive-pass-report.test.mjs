import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function writeJsonl(baseDir, name, records) {
  await mkdir(baseDir, { recursive: true });
  const path = join(baseDir, `${name}.jsonl`);
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path, body ? `${body}\n` : "", "utf8");
}

test("report current route prelive pass writes summary from stored runs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-pass-report-"));
  const dataDir = join(cwd, "data");
  await writeJsonl(dataDir, "current-route-prelive-passes", [
    {
      observedAt: "2026-04-14T07:00:00.000Z",
      runId: "pass-preview",
      mode: "preview",
      executionStatus: "preview",
      finalStatus: "connected_refresh_required",
      nextAction: {
        code: "execute_connected_refresh",
      },
      initialPass: {
        nextAction: {
          code: "execute_connected_refresh",
          command: "npm run run:connected-refresh-package -- --execute",
        },
        exactRouteFork: {
          submitCommand: 'npm run submit:prelive-fork-execution -- --plan-id="plan-123"',
        },
      },
    },
  ]);

  const result = spawnSync(process.execPath, [join(ROOT, "src/cli/report-current-route-prelive-pass.mjs"), "--write"], {
    cwd,
    env: {
      ...process.env,
      BOB_CLAW_DATA_DIR: dataDir,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /latestStatus=connected_refresh_required/);
  const summary = JSON.parse(await readFile(join(dataDir, "current-route-prelive-pass-summary.json"), "utf8"));
  assert.equal(summary.previewCount, 1);
  assert.equal(summary.latestStatus, "connected_refresh_required");
  assert.equal(summary.nextAction.code, "execute_connected_refresh");
});
