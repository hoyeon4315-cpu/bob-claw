import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parsePositiveIntegerOption } from "./cyclomatic-complexity-cli.mjs";
import { lintCyclomaticComplexity, listTrackedComplexityFiles } from "./validate-cyclomatic-complexity.mjs";

const DEFAULT_LIMIT = 20;

function parseArgs(argv) {
  let json = false;
  let limit = DEFAULT_LIMIT;
  let threshold = 20;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--limit") {
      const rawValue = argv[index + 1] ?? "";
      limit = parsePositiveIntegerOption(rawValue, "--limit");
      index += 1;
      continue;
    }
    if (arg === "--threshold") {
      const rawValue = argv[index + 1] ?? "";
      threshold = parsePositiveIntegerOption(rawValue, "--threshold");
      index += 1;
    }
  }

  return { json, limit, threshold };
}

function byDescendingComplexity(left, right) {
  const complexityDelta = (right.complexity ?? 0) - (left.complexity ?? 0);
  if (complexityDelta !== 0) {
    return complexityDelta;
  }
  const fileDelta = left.filePath.localeCompare(right.filePath);
  if (fileDelta !== 0) {
    return fileDelta;
  }
  return left.line - right.line;
}

export async function buildCyclomaticComplexityReport(argv = []) {
  const options = parseArgs(argv);
  const targetFiles = listTrackedComplexityFiles();
  const report = await lintCyclomaticComplexity(targetFiles, options.threshold);
  const topOffenders = [...report.errors].sort(byDescendingComplexity).slice(0, options.limit);
  return {
    filesChecked: report.filesChecked,
    offenderCount: report.errorCount,
    scope: ["src/**/*.mjs", "scripts/**/*.mjs", "test/**/*.mjs", "*.config.mjs"],
    threshold: options.threshold,
    topOffenders,
  };
}

function printHuman(report) {
  console.log(`threshold=${report.threshold}`);
  console.log(`filesChecked=${report.filesChecked}`);
  console.log(`offenderCount=${report.offenderCount}`);
  for (const offender of report.topOffenders) {
    console.log(`${offender.filePath}:${offender.line}:${offender.column} complexity=${offender.complexity ?? "?"}`);
    console.log(`  ${offender.message}`);
  }
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  try {
    const report = await buildCyclomaticComplexityReport(process.argv.slice(2));
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHuman(report);
    }
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}
