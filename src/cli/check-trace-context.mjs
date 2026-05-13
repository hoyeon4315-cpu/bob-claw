#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { createLogger } from "../logger.mjs";
import { childTraceContext, createTraceContext, traceContextFromHeaders, traceHeaders } from "../trace-context.mjs";

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const args = {
    requestId: env.BOB_CLAW_REQUEST_ID || null,
    traceId: env.BOB_CLAW_TRACE_ID || null,
    traceparent: env.BOB_CLAW_TRACEPARENT || env.TRACEPARENT || null,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") args.help = true;
    if (arg.startsWith("--request-id=")) args.requestId = arg.slice("--request-id=".length);
    if (arg.startsWith("--trace-id=")) args.traceId = arg.slice("--trace-id=".length);
    if (arg.startsWith("--traceparent=")) args.traceparent = arg.slice("--traceparent=".length);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node src/cli/check-trace-context.mjs [--request-id=id] [--trace-id=hex32] [--traceparent=value]

Emits one non-live structured log event with propagated trace metadata.`);
}

export function buildTraceContextSmoke({ argv = process.argv.slice(2), env = process.env } = {}) {
  const args = parseArgs(argv, env);
  if (args.help) return { helped: true };
  const root = args.traceparent
    ? traceContextFromHeaders(
        {
          traceparent: args.traceparent,
          "X-Request-ID": args.requestId,
          "X-Trace-ID": args.traceId,
        },
        {
          boundary: "cli",
          name: "check-trace-context",
          component: "check-trace-context",
          operation: "trace_context_smoke",
        },
      )
    : createTraceContext({
        boundary: "cli",
        name: "check-trace-context",
        component: "check-trace-context",
        operation: "trace_context_smoke",
        requestId: args.requestId,
        traceId: args.traceId,
      });
  const child = childTraceContext(root, {
    boundary: "logger",
    name: "structured-log-event",
    component: "check-trace-context",
    operation: "emit_structured_log",
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
