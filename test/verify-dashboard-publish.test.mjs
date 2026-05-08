import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { verifyDashboardPublish } from "../src/cli/verify-dashboard-publish.mjs";

async function writeJson(path, payload) {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function withDashboardFixtures(callback) {
  const dir = await mkdtemp(join(tmpdir(), "dashboard-publish-"));
  try {
    const now = "2026-05-08T06:00:00.000Z";
    const generatedAt = "2026-05-08T05:50:00.000Z";
    await writeJson(join(dir, "dashboard-status.json"), { schemaVersion: 2, generatedAt });
    await writeJson(join(dir, "wallet-holdings.json"), { schemaVersion: 1, generatedAt });
    await writeJson(join(dir, "strategy-tick-status.json"), {
      schemaVersion: 2,
      generatedAt,
      latestTickAt: "2026-05-08T05:30:00.000Z",
    });
    await writeJson(join(dir, "auto-kill-events.json"), { schemaVersion: 1, generatedAt });
    await writeJson(join(dir, "live-runtime.json"), { schemaVersion: 1, generatedAt, enabled: true });
    await callback({ dir, now });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("verify dashboard publish accepts fresh public slices", async () => {
  await withDashboardFixtures(async ({ dir, now }) => {
    const result = await verifyDashboardPublish({ publicDir: dir, now });

    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.latestTickAt, "2026-05-08T05:30:00.000Z");
    assert.equal(result.files.length, 5);
  });
});

test("verify dashboard publish rejects missing schemaVersion", async () => {
  await withDashboardFixtures(async ({ dir, now }) => {
    await writeJson(join(dir, "wallet-holdings.json"), { generatedAt: "2026-05-08T05:50:00.000Z" });

    const result = await verifyDashboardPublish({ publicDir: dir, now });

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.file === "wallet-holdings.json" && error.code === "missing_schemaVersion"));
  });
});

test("verify dashboard publish rejects stale latestTickAt", async () => {
  await withDashboardFixtures(async ({ dir, now }) => {
    await writeJson(join(dir, "strategy-tick-status.json"), {
      schemaVersion: 2,
      generatedAt: "2026-05-08T05:50:00.000Z",
      latestTickAt: "2026-05-06T05:59:00.000Z",
    });

    const result = await verifyDashboardPublish({ publicDir: dir, now });

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === "stale_latestTickAt"));
  });
});
