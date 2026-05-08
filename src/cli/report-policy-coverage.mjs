#!/usr/bin/env node
import { buildPolicyCoverageReport } from "../executor/policy/coverage-report.mjs";

function hasJsonFlag(args = process.argv.slice(2)) {
  return args.includes("--json");
}

function main() {
  const report = buildPolicyCoverageReport();
  if (hasJsonFlag()) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Policy coverage: ${report.summary.enforcedByPolicy}/${report.summary.totalChecks} checks enforced by policy_engine\n`);
  for (const check of report.checks) {
    process.stdout.write(`- ${check.id}: ${check.policyResult} (${check.enforcementFile})\n`);
  }
}

main();
