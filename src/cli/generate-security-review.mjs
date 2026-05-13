#!/usr/bin/env node

import { resolve } from "node:path";

import {
  buildSecurityReviewReport,
  severityMeetsThreshold,
  writeSecurityReviewArtifacts,
} from "../security/security-review-report.mjs";

function parseArgs(argv) {
  const args = {
    outputDir: "security-reports",
    failOn: "critical",
    json: false,
  };
  for (const arg of argv) {
    if (arg === "--json") args.json = true;
    else if (arg.startsWith("--output-dir=")) args.outputDir = arg.slice("--output-dir=".length);
    else if (arg.startsWith("--fail-on=")) args.failOn = arg.slice("--fail-on=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildSecurityReviewReport({ rootDir: process.cwd() });
  const artifacts = await writeSecurityReviewArtifacts({
    report,
    outputDir: resolve(args.outputDir),
  });
  const thresholdFindings = report.findings.filter((item) => severityMeetsThreshold(item.severity, args.failOn));
  const summary = {
    status: thresholdFindings.length ? "fail" : "ok",
    failOn: args.failOn,
    generatedAt: report.generatedAt,
    summary: report.summary,
    artifacts,
  };
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`securityReviewStatus=${summary.status}`);
    console.log(`securityReviewFindings=${report.summary.totalFindings}`);
    console.log(`securityReviewCritical=${report.summary.bySeverity.critical}`);
    console.log(`securityReviewHigh=${report.summary.bySeverity.high}`);
    console.log(`securityReviewMarkdown=${artifacts.markdownPath}`);
    console.log(`securityReviewJson=${artifacts.jsonPath}`);
    console.log(`securityReviewSarif=${artifacts.sarifPath}`);
  }
  if (thresholdFindings.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
