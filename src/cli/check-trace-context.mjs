#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { createLogger } from "../logger.mjs";
import { childTraceContext, createTraceContext, traceHeaders } from "../trace-context.mjs";

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const args = {
    requestId: env.BOB_CLAW_REQUEST_ID || null,
    traceId: env.BOB_CLAW_TRACE_ID || null,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") args.help = true;
    if (arg.startsWith("--request-id=")) args.requestId = arg.slice("--request-id=".length);
    if (arg.startsWith("--trace-id=")) args.traceId = arg.slice("--trace-id=".length);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node src/cli/check-trace-context.mjs [--request-id=id] [--trace-id=hex32]

Emits one non-live structured log event with propagated trace metadata.`);
}

export function buildTraceContextSmoke({ argv = process.argv.slice(2), env = process.env } = {}) {
  const args = parseArgs(argv, env);
  if (args.help) return { helped: true };
  const root = createTraceContext({
    boundary: "cli",
    name: "check-trace-context",
    requestId: args.requestId,
    traceId: args.traceId,
  });
  const child = childTraceContext(root, {
    boundary: "logger",
    name: "structured-log-event",
  });
  return {
    child,
    headers: traceHeaders(child),
    root,
  };
}

export async function runTraceContextCheck(argv = process.argv.slice(2), env = process.env) {
  const smoke = buildTraceContextSmoke({ argv, env });
  if (smoke.helped) {
    printHelp();
    return smoke;
  }
  const logger = createLogger({
    component: "check-trace-context",
    traceContext: smoke.child,
  });
  const record = logger.info("trace_context_check", {
    status: "ok",
    propagatedHeaders: smoke.headers,
    parentSpanId: smoke.child.parentSpanId,
  });
  await logger.flush();
  return record;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTraceContextCheck().catch((error) => {
    const logger = createLogger({ component: "check-trace-context" });
    logger.error("trace_context_check_failed", { error });
    process.exitCode = 1;
  });
}
