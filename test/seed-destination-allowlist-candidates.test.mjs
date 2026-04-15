import assert from "node:assert/strict";
import { test } from "node:test";

test("seed destination allowlist candidates marks eligible board items as candidate_for_review", async () => {
  const { readFile, mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");

  const execFileAsync = promisify(execFile);
  const tempDir = await mkdtemp(join(tmpdir(), "bob-claw-seed-allowlist-"));
  const dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });

  await writeFile(
    join(dataDir, "destination-allowlist-board.json"),
    `${JSON.stringify(
      {
        items: [
          {
            templateId: "base:stablecoin_lending_carry",
            chain: "base",
            familyId: "stablecoin_lending_carry",
            label: "Stablecoin lending carry",
            category: "yield",
            recommendation: { status: "candidate_for_allowlist_review" },
          },
          {
            templateId: "base:custom_destination_actions",
            chain: "base",
            familyId: "custom_destination_actions",
            label: "Gateway custom destination actions",
            category: "platform",
            recommendation: { status: "manual_contract_review" },
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
    ["/Users/love/BOB Claw/src/cli/seed-destination-allowlist-candidates.mjs", "--write"],
    {
      cwd: "/Users/love/BOB Claw",
      env: {
        ...process.env,
        BOB_CLAW_DATA_DIR: dataDir,
      },
    },
  );

  const updated = JSON.parse(await readFile(join(dataDir, "destination-input-overrides.json"), "utf8"));
  assert.equal(updated.entries.length, 1);
  assert.equal(updated.entries[0].templateId, "base:stablecoin_lending_carry");
  assert.equal(updated.entries[0].values.allowlistDecision, "candidate_for_review");
});
