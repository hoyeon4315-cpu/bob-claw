import assert from "node:assert/strict";
import { test } from "node:test";

test("observation-first destination economics flow updates reports from fresh overrides", async () => {
  const { readFile, mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");

  const execFileAsync = promisify(execFile);
  const tempDir = await mkdtemp(join(tmpdir(), "bob-claw-econ-flow-"));
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
  await writeFile(
    join(dataDir, "destination-admission-checklist.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: "2026-04-14T12:31:00.000Z",
        chains: [
          {
            chain: "base",
            templates: [
              {
                templateId: "base:stablecoin_lending_carry",
                chain: "base",
                familyId: "stablecoin_lending_carry",
                label: "Stablecoin lending carry",
                category: "yield",
                gateStatus: "research_only",
                overfitRisk: "low",
                scoring: {
                  deploymentPriorityScore: 0.66,
                },
                admission: {
                  requiredFields: [
                    "allowlistDecision",
                    "grossReturnBps",
                    "depositFeeBps",
                    "withdrawFeeBps",
                    "unwindSlippageBps",
                    "sourceName",
                    "sourceType",
                    "lastVerifiedAt",
                  ],
                },
                defaults: {
                  allowlistDecision: "approved",
                  sourceName: "Example Protocol",
                  sourceType: "official_docs",
                  lastVerifiedAt: "2026-04-14",
                },
                nextAction: "collect sourced economics snapshot",
                notes: [],
              },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(dataDir, "destination-allowlist-board.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        items: [
          {
            templateId: "base:stablecoin_lending_carry",
            chain: "base",
            familyId: "stablecoin_lending_carry",
            label: "Stablecoin lending carry",
            score: 0.66,
            values: {
              allowlistDecision: "approved",
            },
            recommendation: {
              status: "candidate_for_allowlist_review",
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(dataDir, "destination-evidence-policy.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        items: [
          {
            templateId: "base:stablecoin_lending_carry",
            unmetPolicyInputs: [],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(dataDir, "destination-evidence-freshness-audit.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        items: [
          {
            templateId: "base:stablecoin_lending_carry",
            freshnessStatus: "fresh",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const env = {
    ...process.env,
    BOB_CLAW_DATA_DIR: dataDir,
  };

  for (const [field, value] of [
    ["grossReturnBps", "120"],
    ["depositFeeBps", "10"],
    ["withdrawFeeBps", "10"],
    ["unwindSlippageBps", "20"],
    ["withdrawalDelayHours", "0"],
  ]) {
    await execFileAsync(
      "node",
      [
        "/Users/love/BOB Claw/src/cli/add-destination-economics-observation.mjs",
        "--template-id=base:stablecoin_lending_carry",
        `--field=${field}`,
        `--value=${value}`,
        "--source-name=Example Protocol",
        "--source-type=official_docs",
        "--observed-at=2026-04-14",
        "--write",
      ],
      {
        cwd: "/Users/love/BOB Claw",
        env,
      },
    );
  }

  await execFileAsync("node", ["/Users/love/BOB Claw/src/cli/sync-destination-economics-observations.mjs", "--write"], {
    cwd: "/Users/love/BOB Claw",
    env,
  });

  const overrides = JSON.parse(await readFile(join(dataDir, "destination-input-overrides.json"), "utf8"));
  assert.equal(overrides.entries[0].values.grossReturnBps, 120);
  assert.equal(overrides.entries[0].values.unwindSlippageBps, 20);
  assert.equal(overrides.entries[0].values.sourceName, "Example Protocol");
  assert.equal(overrides.entries[0].values.sourceType, "official_docs");
  assert.equal(overrides.entries[0].values.lastVerifiedAt, "2026-04-14");

  const estimatedOutput = await execFileAsync(
    "node",
    ["/Users/love/BOB Claw/src/cli/report-destination-estimated-economics.mjs", "--json"],
    {
      cwd: "/Users/love/BOB Claw",
      env,
    },
  );
  const estimated = JSON.parse(estimatedOutput.stdout);
  assert.equal(estimated.summary.estimatedCount, 1);
  assert.equal(estimated.summary.activeBudgetPolicyPassCount, 1);
  assert.equal(estimated.items[0].economicsStatus, "estimated");

  const queueOutput = await execFileAsync(
    "node",
    ["/Users/love/BOB Claw/src/cli/report-destination-economics-queue.mjs", "--json"],
    {
      cwd: "/Users/love/BOB Claw",
      env,
    },
  );
  const queue = JSON.parse(queueOutput.stdout);
  assert.equal(queue.summary.queueCount, 0);

  const packetOutput = await execFileAsync(
    "node",
    ["/Users/love/BOB Claw/src/cli/report-destination-economics-packet.mjs", "--json"],
    {
      cwd: "/Users/love/BOB Claw",
      env,
    },
  );
  const packet = JSON.parse(packetOutput.stdout);
  assert.equal(packet.summary.itemCount, 0);

  const gateOutput = await execFileAsync(
    "node",
    ["/Users/love/BOB Claw/src/cli/report-destination-promotion-gate.mjs", "--json"],
    {
      cwd: "/Users/love/BOB Claw",
      env,
    },
  );
  const gate = JSON.parse(gateOutput.stdout);
  assert.equal(gate.summary.promotableCount, 1);
  assert.equal(gate.summary.blockedCount, 0);

  const evidencePolicyOutput = await execFileAsync(
    "node",
    ["/Users/love/BOB Claw/src/cli/report-destination-evidence-policy.mjs", "--json"],
    {
      cwd: "/Users/love/BOB Claw",
      env,
    },
  );
  const evidencePolicy = JSON.parse(evidencePolicyOutput.stdout);
  assert.equal(evidencePolicy.summary.inputsSeededCount, 1);
  assert.deepEqual(evidencePolicy.items[0].unmetPolicyInputs, []);
});
