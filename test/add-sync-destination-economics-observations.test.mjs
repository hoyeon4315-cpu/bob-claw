import assert from "node:assert/strict";
import { test } from "node:test";

test("add and sync destination economics observations writes latest values into overrides", async () => {
  const { readFile, mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");

  const execFileAsync = promisify(execFile);
  const tempDir = await mkdtemp(join(tmpdir(), "bob-claw-econ-obs-"));
  const dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });

  await writeFile(
    join(dataDir, "destination-economics-observations.json"),
    `${JSON.stringify({ schemaVersion: 1, entries: [] }, null, 2)}\n`,
  );
  await writeFile(
    join(dataDir, "destination-input-overrides.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        entries: [
          {
            templateId: "base:stablecoin_lending_carry",
            status: "partially_seeded",
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
      "/Users/love/BOB Claw/src/cli/add-destination-economics-observation.mjs",
      "--template-id=base:stablecoin_lending_carry",
      "--field=grossReturnBps",
      "--value=120",
      "--source-name=Example Protocol",
      "--source-type=official_docs",
      "--observed-at=2026-04-14",
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

  await execFileAsync("node", ["/Users/love/BOB Claw/src/cli/sync-destination-economics-observations.mjs", "--write"], {
    cwd: "/Users/love/BOB Claw",
    env: {
      ...process.env,
      BOB_CLAW_DATA_DIR: dataDir,
    },
  });

  const overrides = JSON.parse(await readFile(join(dataDir, "destination-input-overrides.json"), "utf8"));
  assert.equal(overrides.entries[0].values.grossReturnBps, 120);
});
