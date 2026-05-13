import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyCommandRisk,
  classifyReferencedPath,
  collectInlineCodeEntries,
  extractCommandReferences,
  extractPathReferences,
  validateAgentsFreshnessText,
} from "../scripts/check-agents-freshness.mjs";

test("collectInlineCodeEntries captures inline and fenced code spans", () => {
  const entries = collectInlineCodeEntries(
    [
      "Use `npm run report:capital-audit -- --json` first.",
      "```bash",
      "node src/cli/check-full-automation-readiness.mjs --json",
      "```",
    ].join("\n"),
  );

  assert.deepEqual(
    entries.map((entry) => ({ kind: entry.kind, value: entry.value })),
    [
      { kind: "inline", value: "npm run report:capital-audit -- --json" },
      { kind: "fenced", value: "node src/cli/check-full-automation-readiness.mjs --json" },
    ],
  );
});

test("extractCommandReferences expands npm run alternates and keeps node/python commands", () => {
  const references = extractCommandReferences(
    [
      "Use `npm run kill:on|kill:off|kill:status` on operator request only.",
      "Diagnostic: `node src/cli/check-full-automation-readiness.mjs --json`",
      "Graphify: `python3 -m graphify query/explain/path`",
    ].join("\n"),
  );

  assert.deepEqual(
    references.map((entry) => ({
      command: entry.command,
      scripts: entry.npmScripts || [],
      file: entry.nodeFile || null,
      tool: entry.pythonModule || null,
    })),
    [
      { command: "npm run kill:on", scripts: ["kill:on"], file: null, tool: null },
      { command: "npm run kill:off", scripts: ["kill:off"], file: null, tool: null },
      { command: "npm run kill:status", scripts: ["kill:status"], file: null, tool: null },
      {
        command: "node src/cli/check-full-automation-readiness.mjs --json",
        scripts: [],
        file: "src/cli/check-full-automation-readiness.mjs",
        tool: null,
      },
      {
        command: "python3 -m graphify query/explain/path",
        scripts: [],
        file: null,
        tool: "graphify",
      },
    ],
  );
});

test("extractPathReferences keeps source and generated paths while ignoring env vars", () => {
  const references = extractPathReferences(
    [
      "Read `docs/system-map.md` and inspect `dashboard/public/dashboard-status.json`.",
      "Runtime output lands in `logs/signer-audit.jsonl` and `data/all-chain-autopilot-latest.json`.",
      "Do not treat `$KILL_SWITCH_PATH` as a repo path.",
    ].join("\n"),
  );

  assert.deepEqual(
    references.map((entry) => entry.path),
    [
      "docs/system-map.md",
      "dashboard/public/dashboard-status.json",
      "logs/signer-audit.jsonl",
      "data/all-chain-autopilot-latest.json",
    ],
  );
});

test("classifyReferencedPath distinguishes source, generated, patterns, and external placeholders", () => {
  assert.equal(classifyReferencedPath("docs/system-map.md").kind, "source");
  assert.equal(classifyReferencedPath("dashboard/public/dashboard-status.json").kind, "generated");
  assert.equal(classifyReferencedPath("src/config/*.mjs").kind, "pattern");
  assert.equal(classifyReferencedPath("$KILL_SWITCH_PATH").kind, "external");
});

test("classifyCommandRisk marks readonly probes separately from execution-capable commands", () => {
  assert.equal(classifyCommandRisk("node src/cli/check-full-automation-readiness.mjs --json").risk, "readonly_probe");
  assert.equal(classifyCommandRisk("npm run report:capital-audit -- --json").risk, "readonly_probe");
  assert.equal(classifyCommandRisk("npm run executor:daemon").risk, "unsafe_live");
  assert.equal(classifyCommandRisk("npm run kill:on -- --reason=test").risk, "unsafe_live");
  assert.equal(classifyCommandRisk("npm run deploy:dashboard:cloudflare").risk, "unsafe_live");
});

test("validateAgentsFreshnessText reports missing scripts and source files but allows generated/runtime paths", () => {
  const result = validateAgentsFreshnessText(
    [
      "Read `docs/system-map.md`.",
      "Watch `dashboard/public/dashboard-status.json`.",
      "Run `npm run report:capital-audit -- --json`.",
      "Run `node src/cli/check-full-automation-readiness.mjs --json`.",
      "Never run `npm run executor:daemon` automatically.",
      "Broken script: `npm run missing:script`.",
      "Broken file: `node src/cli/missing-file.mjs --json`.",
      "Missing source path: `docs/missing.md`.",
    ].join("\n"),
    {
      packageScripts: new Set(["report:capital-audit", "executor:daemon"]),
      pathExists: (targetPath) =>
        new Set([
          "AGENTS.md",
          "docs/system-map.md",
          "dashboard/public/dashboard-status.json",
          "src/cli/check-full-automation-readiness.mjs",
        ]).has(targetPath),
    },
  );

  assert.equal(result.failures.length, 3);
  assert.equal(
    result.failures.some((failure) => /missing npm script/i.test(failure)),
    true,
  );
  assert.equal(
    result.failures.some((failure) => /missing node entrypoint/i.test(failure)),
    true,
  );
  assert.equal(
    result.failures.some((failure) => /missing source path/i.test(failure)),
    true,
  );
  assert.equal(result.summary.generatedPathCount, 1);
  assert.equal(result.summary.unsafeCommandCount, 1);
  assert.equal(result.summary.readonlyProbeCommandCount, 3);
});
