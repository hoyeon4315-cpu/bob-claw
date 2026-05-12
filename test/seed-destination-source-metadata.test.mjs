import assert from "node:assert/strict";
import { test } from "node:test";
import { REPO_ROOT, repoPath } from "./helpers/repo-root.mjs";

test("seed destination source metadata updates matching families in overrides", async () => {
  const { readFile, mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");

  const execFileAsync = promisify(execFile);
  const tempDir = await mkdtemp(join(tmpdir(), "bob-claw-seed-source-"));
  const dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });

  await writeFile(
    join(dataDir, "destination-input-workbench.json"),
    `${JSON.stringify(
      {
        workItems: [
          {
            templateId: "base:wrapped_btc_lending",
            chain: "base",
            familyId: "wrapped_btc_lending",
            label: "Wrapped BTC -> lending positions",
            category: "yield",
          },
          {
            templateId: "bsc:wrapped_btc_lending",
            chain: "bsc",
            familyId: "wrapped_btc_lending",
            label: "Wrapped BTC -> lending positions",
            category: "yield",
          },
          {
            templateId: "base:stablecoin_lending_carry",
            chain: "base",
            familyId: "stablecoin_lending_carry",
            label: "Stablecoin lending carry",
            category: "yield",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  await writeFile(
    join(dataDir, "destination-input-overrides.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        entries: [],
      },
      null,
      2,
    )}\n`,
  );

  await execFileAsync(
    "node",
    [
      repoPath("src/cli/seed-destination-source-metadata.mjs"),
      "--family-ids=wrapped_btc_lending",
      "--source-name=BOB Gateway Overview",
      "--source-type=official_docs",
      "--last-verified-at=2026-04-14",
      "--write",
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        BOB_CLAW_DATA_DIR: dataDir,
      },
    },
  );

  const updated = JSON.parse(await readFile(join(dataDir, "destination-input-overrides.json"), "utf8"));
  assert.equal(updated.entries.length, 2);
  assert.equal(updated.entries[0].values.sourceName, "BOB Gateway Overview");
  assert.equal(updated.entries[1].familyId, "wrapped_btc_lending");
});
