#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { createLogger } from "../logger.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    filePath: null,
    level: "info",
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--file=")) {
      args.filePath = arg.slice("--file=".length);
    } else if (arg.startsWith("--level=")) {
      args.level = arg.slice("--level=".length);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node src/cli/check-structured-logger.mjs [--file=path] [--level=info]

Emits one non-live structured observability event.
The optional --file target is append-only and must not be an audit or receipt log.`);
}

export async function runStructuredLoggerCheck(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { helped: true };
  }

  const logger = createLogger({
    component: "check-structured-logger",
    level: args.level,
    filePath: args.filePath,
  });

  const record = logger.info("structured_logger_check", {
    status: "ok",
    outputFormat: "jsonl",
    stdoutStderr: "info_debug_stdout_warn_error_stderr",
    fileAppend: args.filePath ? "enabled" : "disabled",
    auditLogRole: "none_observability_only",
  });
  await logger.flush();
  return record;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStructuredLoggerCheck().catch((error) => {
    const logger = createLogger({ component: "check-structured-logger" });
    logger.error("structured_logger_check_failed", { error });
    process.exitCode = 1;
  });
}
