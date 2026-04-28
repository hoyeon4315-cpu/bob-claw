import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeDashboardStatus } from "../src/status/dashboard-status.mjs";

test("writeDashboardStatus repairs an invalid existing public snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-dashboard-status-"));
  const path = join(dir, "dashboard-status.json");
  await writeFile(path, '{"schemaVersion":2}\ntrailing-fragment\n', "utf8");

  const result = await writeDashboardStatus(dir, {
    schemaVersion: 2,
    generatedAt: "2026-04-29T00:00:00.000Z",
    overall: { liveTrading: "BLOCKED" },
  });

  assert.equal(result.changed, true);
  const written = await readFile(path, "utf8");
  assert.doesNotThrow(() => JSON.parse(written));
  assert.equal(JSON.parse(written).generatedAt, "2026-04-29T00:00:00.000Z");
});
