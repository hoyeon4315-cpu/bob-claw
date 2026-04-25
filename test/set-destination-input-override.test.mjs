import assert from "node:assert/strict";
import { test } from "node:test";

test("set destination input override updates an existing stub entry", async () => {
  const { readFile, mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");

  const execFileAsync = promisify(execFile);
  const tempDir = await mkdtemp(join(tmpdir(), "bob-claw-set-"));
  const dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });

  const overridesPath = join(dataDir, "destination-input-overrides.json");
  await writeFile(
    overridesPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        entries: [
          {
            templateId: "base:stablecoin_lending_carry",
            status: "stub",
            values: {},
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  await execFileAsync(
    "node",
    [
      "/Users/love/BOB Claw/src/cli/set-destination-input-override.mjs",
      "--template-id=base:stablecoin_lending_carry",
      "--set=sourceName=Example Protocol",
      "--set=grossReturnBps=120",
      "--write",
    ],
    {
      cwd: "/Users/love/BOB Claw",
      env: {
        ...process.env,
        BOB_CLAW_DATA_DIR: dataDir,
      },
    },
  );

  const updated = JSON.parse(await readFile(overridesPath, "utf8"));
  assert.equal(updated.entries.length, 1);
  assert.equal(updated.entries[0].status, "partially_seeded");
  assert.equal(updated.entries[0].values.sourceName, "Example Protocol");
  assert.equal(updated.entries[0].values.grossReturnBps, 120);
});

test("set destination input override accepts set-json for values with spaces", async () => {
  const { readFile, mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");

  const execFileAsync = promisify(execFile);
  const tempDir = await mkdtemp(join(tmpdir(), "bob-claw-set-json-"));
  const dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });

  const overridesPath = join(dataDir, "destination-input-overrides.json");
  await writeFile(
    overridesPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        entries: [
          {
            templateId: "base:custom_destination_actions",
            status: "stub",
            values: {},
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  await execFileAsync(
    "node",
    [
      "/Users/love/BOB Claw/src/cli/set-destination-input-override.mjs",
      "--template-id=base:custom_destination_actions",
      '--set-json={"sourceName":"BOB Gateway Overview","sourceType":"official_docs","lastVerifiedAt":"2026-04-14"}',
      "--write",
    ],
    {
      cwd: "/Users/love/BOB Claw",
      env: {
        ...process.env,
        BOB_CLAW_DATA_DIR: dataDir,
      },
    },
  );

  const updated = JSON.parse(await readFile(overridesPath, "utf8"));
  assert.equal(updated.entries[0].values.sourceName, "BOB Gateway Overview");
  assert.equal(updated.entries[0].values.sourceType, "official_docs");
});
