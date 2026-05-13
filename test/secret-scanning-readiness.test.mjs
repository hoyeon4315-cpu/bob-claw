import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("repository exposes a real secret scanning command and CI hook", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const workflow = await readFile(new URL("../.github/workflows/auto-pr-validate.yml", import.meta.url), "utf8");

  assert.equal(
    packageJson.scripts?.["check:secret-scanning"],
    "node scripts/check-secret-scanning.mjs",
    "package.json must expose a runnable secret scanning command",
  );
  assert.equal(
    packageJson.scripts?.["update:secret-scanning-baseline"],
    "node scripts/check-secret-scanning.mjs --write-baseline",
    "package.json must expose a baseline refresh command",
  );
  assert.match(workflow, /npm run check:secret-scanning/u, "CI must run the secret scanning command");
  assert.match(workflow, /detect-secrets==1\.5\.0/u, "CI must install a pinned detect-secrets release");
});

test("secret scanning helper excludes generated outputs but keeps source-like files", async () => {
  const { classifySecretScanFiles } = await import("../scripts/check-secret-scanning.mjs");
  const plan = classifySecretScanFiles([
    "src/llm/context-pack.mjs",
    "test/codex-llm.test.mjs",
    "docs/system-map.md",
    "dashboard/public/dashboard-status.json",
    "dashboard/public/index.html",
    "logs/signer-audit.jsonl",
    "data/all-chain-autopilot-latest.json",
    ".github/workflows/auto-pr-validate.yml",
    ".env.example",
  ]);

  assert.deepEqual(plan.excludedFiles, [
    "dashboard/public/dashboard-status.json",
    "logs/signer-audit.jsonl",
    "data/all-chain-autopilot-latest.json",
  ]);
  assert.deepEqual(plan.includedFiles, [
    "src/llm/context-pack.mjs",
    "test/codex-llm.test.mjs",
    "docs/system-map.md",
    "dashboard/public/index.html",
    ".github/workflows/auto-pr-validate.yml",
    ".env.example",
  ]);
});

test("secret scanning baseline is non-empty and stores redacted findings", async () => {
  const baseline = JSON.parse(await readFile(new URL("../.secrets.baseline", import.meta.url), "utf8"));
  const resultEntries = Object.entries(baseline.results || {});

  assert.ok(resultEntries.length > 0, "baseline must capture reviewed existing findings");
  assert.ok(
    resultEntries.every(([, findings]) => findings.every((finding) => typeof finding.hashed_secret === "string")),
    "baseline findings must store hashed secrets instead of raw values",
  );
});
