import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SEVERITIES = ["info", "low", "moderate", "high", "critical"];
const MAX_SCAN_BYTES = 1_000_000;

const GENERATED_OR_RUNTIME_PATHS = [
  /^data\//u,
  /^logs\//u,
  /^state\//u,
  /^coverage\//u,
  /^dist\//u,
  /^out\//u,
  /^cache\//u,
  /^node_modules\//u,
  /^dashboard\/public\/.*\.json$/u,
  /^security-reports\//u,
  /^src\/graphify-out\//u,
  /^graphify-out\//u,
  /^\.cloudflare\//u,
  /^\.wrangler\//u,
  /^\.playwright-cli\//u,
];

const TEXT_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".md",
  ".sh",
  ".sol",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const SECRET_RULES = [
  {
    ruleId: "secret:credential-literal",
    title: "Secret or credential-like literal",
    severity: "high",
    pattern:
      /\b(?:api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|bearer[_-]?token|secret|private[_-]?key|seed[_-]?phrase|mnemonic|telegram[_-]?bot[_-]?token)\b[^=\n:]{0,80}(?:=|:)\s*["'`]([^"'`]{12,})["'`]/iu,
  },
  {
    ruleId: "secret:evm-private-key-literal",
    title: "EVM private-key-shaped literal",
    severity: "critical",
    pattern:
      /\b(?:private[_-]?key|secret|BURNER_(?:EVM|BTC|PRIVATE)_KEY)\b[^=\n:]{0,80}(?:=|:)\s*["'`](0x[a-f0-9]{64})["'`]/iu,
  },
  {
    ruleId: "secret:bitcoin-wif-literal",
    title: "Bitcoin WIF-shaped literal",
    severity: "critical",
    pattern: /\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/u,
  },
  {
    ruleId: "secret:raw-signed-transaction",
    title: "Raw signed-transaction-shaped payload",
    severity: "high",
    pattern: /\b0x(?:01|02)?f8[a-f0-9]{80,}\b/iu,
  },
];

const STATIC_RULES = [
  {
    ruleId: "sast:eval",
    title: "Dynamic eval execution",
    severity: "high",
    pattern: /\beval\s*\(/u,
  },
  {
    ruleId: "sast:new-function",
    title: "Dynamic Function constructor",
    severity: "high",
    pattern: /\bnew\s+Function\s*\(/u,
  },
  {
    ruleId: "sast:child-process-shell",
    title: "Child process shell execution requires review",
    severity: "moderate",
    pattern: /\b(?:exec|execSync)\s*\(/u,
  },
];

function severityRank(severity) {
  return SEVERITIES.indexOf(severity);
}

export function severityMeetsThreshold(severity, threshold = "critical") {
  if (threshold === "none") return false;
  return severityRank(severity) >= severityRank(threshold);
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function shouldScanPath(path) {
  const normalized = normalizePath(path);
  if (GENERATED_OR_RUNTIME_PATHS.some((pattern) => pattern.test(normalized))) return false;
  const dot = normalized.lastIndexOf(".");
  const extension = dot === -1 ? "" : normalized.slice(dot);
  return TEXT_FILE_EXTENSIONS.has(extension);
}

function isAllowedSecretReference(line) {
  return (
    /\bprocess\.env\b/u.test(line) ||
    /_PATH\b/u.test(line) ||
    /\b(redacted|placeholder|example|dummy|fixture)\b/iu.test(line)
  );
}

function finding({ scanner, ruleId, title, severity, path, line }) {
  const testFixtureSecret = scanner === "secret-scan" && normalizePath(path).startsWith("test/");
  return {
    scanner,
    ruleId,
    title: testFixtureSecret ? `Test fixture ${title}` : title,
    severity: testFixtureSecret ? "info" : severity,
    path,
    line,
    redacted: true,
    context: testFixtureSecret ? "test_fixture" : "source",
  };
}

export function scanTextForSecurityFindings({ path, text }) {
  const findings = [];
  const lines = text.split(/\r?\n/u);
  lines.forEach((lineText, index) => {
    const line = index + 1;
    for (const rule of SECRET_RULES) {
      if (rule.pattern.test(lineText) && !isAllowedSecretReference(lineText)) {
        findings.push(finding({ scanner: "secret-scan", ...rule, path, line }));
      }
    }
    for (const rule of STATIC_RULES) {
      if (rule.pattern.test(lineText)) {
        findings.push(finding({ scanner: "static-analysis", ...rule, path, line }));
      }
    }
  });
  return findings;
}

export async function listGitTrackedFiles({ rootDir = process.cwd() } = {}) {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: rootDir,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.split("\0").filter(Boolean).map(normalizePath);
}

async function readScannableFile(rootDir, path) {
  const filePath = join(rootDir, path);
  const fileStat = await stat(filePath);
  if (fileStat.size > MAX_SCAN_BYTES) return null;
  return readFile(filePath, "utf8");
}

export async function scanTrackedFiles({ rootDir = process.cwd(), trackedFiles = null } = {}) {
  const files = trackedFiles || (await listGitTrackedFiles({ rootDir }));
  const findings = [];
  const scannedFiles = [];
  for (const path of files.filter(shouldScanPath)) {
    let text = null;
    try {
      text = await readScannableFile(rootDir, path);
    } catch {
      continue;
    }
    scannedFiles.push(path);
    findings.push(...scanTextForSecurityFindings({ path, text }));
  }
  return { scannedFiles, findings };
}

function emptyAuditSummary() {
  return { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
}

function auditSummaryFromMetadata(metadata = {}) {
  const vulnerabilities = metadata.vulnerabilities || {};
  return {
    total: Number(vulnerabilities.total || 0),
    critical: Number(vulnerabilities.critical || 0),
    high: Number(vulnerabilities.high || 0),
    moderate: Number(vulnerabilities.moderate || 0),
    low: Number(vulnerabilities.low || 0),
    info: Number(vulnerabilities.info || 0),
  };
}

function findingsFromNpmAudit(auditJson = {}) {
  const vulnerabilities = auditJson.vulnerabilities || {};
  return Object.entries(vulnerabilities).map(([name, vulnerability]) =>
    finding({
      scanner: "npm-audit",
      ruleId: `npm-audit:${name}`,
      title: `npm audit advisory for ${name}`,
      severity: vulnerability.severity || "moderate",
      path: "package-lock.json",
      line: 1,
    }),
  );
}

export async function runNpmAudit({ rootDir = process.cwd() } = {}) {
  try {
    const { stdout } = await execFileAsync("npm", ["audit", "--json", "--audit-level=low"], {
      cwd: rootDir,
      maxBuffer: 20 * 1024 * 1024,
    });
    const auditJson = JSON.parse(stdout || "{}");
    return {
      available: true,
      ok: true,
      summary: auditSummaryFromMetadata(auditJson.metadata),
      findings: findingsFromNpmAudit(auditJson),
    };
  } catch (error) {
    const stdout = error.stdout || "";
    if (stdout.trim()) {
      const auditJson = JSON.parse(stdout);
      return {
        available: true,
        ok: false,
        summary: auditSummaryFromMetadata(auditJson.metadata),
        findings: findingsFromNpmAudit(auditJson),
      };
    }
    return {
      available: false,
      ok: false,
      summary: emptyAuditSummary(),
      findings: [
        finding({
          scanner: "npm-audit",
          ruleId: "npm-audit:unavailable",
          title: "npm audit did not return parseable JSON",
          severity: "moderate",
          path: "package-lock.json",
          line: 1,
        }),
      ],
    };
  }
}

function summarizeFindings(findings) {
  const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  const byScanner = {};
  for (const item of findings) {
    bySeverity[item.severity] = (bySeverity[item.severity] || 0) + 1;
    byScanner[item.scanner] = (byScanner[item.scanner] || 0) + 1;
  }
  return {
    totalFindings: findings.length,
    bySeverity,
    byScanner,
  };
}

export async function buildSecurityReviewReport({
  rootDir = process.cwd(),
  trackedFiles = null,
  npmAuditRunner = runNpmAudit,
  observedAt = new Date().toISOString(),
} = {}) {
  const [sourceScan, npmAudit] = await Promise.all([
    scanTrackedFiles({ rootDir, trackedFiles }),
    npmAuditRunner({ rootDir }),
  ]);
  const findings = [...sourceScan.findings, ...npmAudit.findings].sort((a, b) => {
    const severityDelta = severityRank(b.severity) - severityRank(a.severity);
    if (severityDelta) return severityDelta;
    return `${a.path}:${a.line}:${a.ruleId}`.localeCompare(`${b.path}:${b.line}:${b.ruleId}`);
  });
  return {
    schemaVersion: 1,
    generatedAt: observedAt,
    scope: {
      rootDir,
      trackedFileCount: trackedFiles?.length ?? null,
      scannedFileCount: sourceScan.scannedFiles.length,
      excludes: ["generated/runtime artifacts", "dashboard public JSON", "logs/data/state/cache directories"],
    },
    scanners: {
      "npm-audit": {
        available: npmAudit.available,
        ok: npmAudit.ok,
        summary: npmAudit.summary,
      },
      "secret-scan": {
        available: true,
        redaction: "matched values are never included in artifacts",
      },
      "static-analysis": {
        available: true,
        rules: STATIC_RULES.map((rule) => rule.ruleId),
      },
    },
    summary: summarizeFindings(findings),
    findings,
  };
}

function markdownTable(findings) {
  if (!findings.length) return "No findings were detected by the configured scanners.\n";
  const rows = ["| Severity | Scanner | Rule | Location | Redaction |", "| --- | --- | --- | --- | --- |"];
  for (const item of findings) {
    rows.push(`| ${item.severity} | ${item.scanner} | ${item.title} | ${item.path}:${item.line} | values redacted |`);
  }
  return `${rows.join("\n")}\n`;
}

export function renderSecurityReviewMarkdown(report) {
  const severity = report.summary.bySeverity;
  return [
    "# BOB Claw Automated Security Review",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Scope",
    "",
    `- Scanned tracked source files: ${report.scope.scannedFileCount}`,
    "- Excluded generated/runtime outputs, logs, data snapshots, caches, and dashboard public JSON.",
    "- Secret-like matches are reported only by path/type/severity; matched values are redacted.",
    "",
    "## Scanner Summary",
    "",
    `- npm audit: ${report.scanners["npm-audit"].available ? "available" : "unavailable"}; vulnerabilities=${report.scanners["npm-audit"].summary.total}`,
    `- redacted secret scan: findings=${report.summary.byScanner["secret-scan"] || 0}`,
    `- lightweight SAST scan: findings=${report.summary.byScanner["static-analysis"] || 0}`,
    "",
    "## Finding Counts",
    "",
    `- total: ${report.summary.totalFindings}`,
    `- critical: ${severity.critical}`,
    `- high: ${severity.high}`,
    `- moderate: ${severity.moderate}`,
    `- low: ${severity.low}`,
    `- info: ${severity.info}`,
    "",
    "## Findings",
    "",
    markdownTable(report.findings),
  ].join("\n");
}

function sarifLevel(severity) {
  if (severity === "critical" || severity === "high") return "error";
  if (severity === "moderate") return "warning";
  return "note";
}

export function renderSecurityReviewSarif(report) {
  const rules = new Map();
  for (const item of report.findings) {
    if (!rules.has(item.ruleId)) {
      rules.set(item.ruleId, {
        id: item.ruleId,
        name: item.title,
        shortDescription: { text: item.title },
        help: { text: "BOB Claw automated security review finding. Values are redacted." },
      });
    }
  }
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "BOB Claw Automated Security Review",
            informationUri: "https://github.com/hoyeon4315-cpu/bob-claw",
            rules: [...rules.values()],
          },
        },
        results: report.findings.map((item) => ({
          ruleId: item.ruleId,
          level: sarifLevel(item.severity),
          message: { text: `${item.title}; value redacted` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: item.path },
                region: { startLine: item.line || 1 },
              },
            },
          ],
          properties: {
            scanner: item.scanner,
            severity: item.severity,
            redacted: true,
          },
        })),
      },
    ],
  };
}

export async function writeSecurityReviewArtifacts({ report, outputDir = "security-reports" } = {}) {
  await mkdir(outputDir, { recursive: true });
  const markdownPath = join(outputDir, "security-review.md");
  const jsonPath = join(outputDir, "security-review.json");
  const sarifPath = join(outputDir, "security-review.sarif");
  await Promise.all([
    writeFile(markdownPath, `${renderSecurityReviewMarkdown(report)}\n`, "utf8"),
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(sarifPath, `${JSON.stringify(renderSecurityReviewSarif(report), null, 2)}\n`, "utf8"),
  ]);
  return { markdownPath, jsonPath, sarifPath };
}
