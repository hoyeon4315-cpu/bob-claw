import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  buildSecurityReviewReport,
  scanTextForSecurityFindings,
  writeSecurityReviewArtifacts,
} from "../src/security/security-review-report.mjs";

test("security review report redacts secret-like values and writes readable artifacts", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-security-review-"));
  try {
    await writeFile(
      join(rootDir, "sample.mjs"),
      [
        'const TELEGRAM_BOT_TOKEN = "1234567890:abcdefghijklmnopqrstuvwxyzABCDEFGHI";',
        "const harmless = process.env.OPENAI_API_KEY_PATH;",
        'const token = { address: "0x1234567890abcdef1234567890abcdef12345678" };',
        'const txHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";',
        "eval(userControlledInput);",
      ].join("\n"),
    );
    await writeFile(join(rootDir, "package.json"), JSON.stringify({ name: "fixture" }));

    const report = await buildSecurityReviewReport({
      rootDir,
      trackedFiles: ["sample.mjs", "package.json"],
      npmAuditRunner: async () => ({
        available: true,
        ok: false,
        summary: { total: 1, critical: 0, high: 1, moderate: 0, low: 0, info: 0 },
        findings: [
          {
            scanner: "npm-audit",
            ruleId: "npm-audit:fixture-package",
            title: "fixture-package advisory",
            severity: "high",
            path: "package.json",
            line: 1,
            redacted: true,
          },
        ],
      }),
    });

    assert.equal(report.summary.totalFindings, 3);
    assert.equal(report.summary.bySeverity.high, 3);
    assert.equal(report.summary.byScanner["secret-scan"], 1);
    assert.equal(report.summary.byScanner["static-analysis"], 1);

    for (const finding of report.findings) {
      assert.equal(JSON.stringify(finding).includes("1234567890:abcdefghijklmnopqrstuvwxyzABCDEFGHI"), false);
    }

    const outputDir = join(rootDir, "security-reports");
    const artifacts = await writeSecurityReviewArtifacts({ report, outputDir });
    const markdown = await readFile(artifacts.markdownPath, "utf8");
    const json = await readFile(artifacts.jsonPath, "utf8");
    const sarif = await readFile(artifacts.sarifPath, "utf8");

    assert.match(markdown, /# BOB Claw Automated Security Review/u);
    assert.match(markdown, /Secret or credential-like literal/u);
    assert.match(markdown, /redacted/u);
    assert.equal(markdown.includes("1234567890:abcdefghijklmnopqrstuvwxyzABCDEFGHI"), false);
    assert.equal(json.includes("1234567890:abcdefghijklmnopqrstuvwxyzABCDEFGHI"), false);
    assert.equal(JSON.parse(sarif).version, "2.1.0");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("security review keeps test fixture credential literals visible without failing as live secrets", () => {
  const fixtureFindings = scanTextForSecurityFindings({
    path: "test/fixture.test.mjs",
    text: 'const PRIVATE_KEY = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";',
  });
  assert.equal(fixtureFindings.length, 2);
  assert.equal(
    fixtureFindings.every((item) => item.severity === "info"),
    true,
  );
  assert.equal(
    fixtureFindings.every((item) => item.title.includes("Test fixture")),
    true,
  );
});
