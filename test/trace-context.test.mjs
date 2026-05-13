import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { createLogger } from "../src/logger.mjs";
import {
  childTraceContext,
  createTraceContext,
  isValidTraceId,
  traceContextFromHeaders,
  traceHeaders,
} from "../src/trace-context.mjs";

function captureStream() {
  const writes = [];
  return {
    writes,
    write(line) {
      writes.push(line);
    },
  };
}

test("trace context propagates request id and parent span across child work", () => {
  const root = createTraceContext({
    boundary: "http",
    name: "dashboard-probe",
    requestId: "operator-check-42",
    component: "status-dashboard",
    operation: "ingress",
    startedAt: "2026-05-13T00:00:00.000Z",
  });
  const child = childTraceContext(root, {
    boundary: "status",
    name: "build-dashboard",
    operation: "build_dashboard_status",
  });

  assert.equal(root.requestId, "operator-check-42");
  assert.equal(isValidTraceId(root.traceId), true);
  assert.equal(child.traceId, root.traceId);
  assert.equal(child.requestId, root.requestId);
  assert.equal(child.parentSpanId, root.spanId);
  assert.notEqual(child.spanId, root.spanId);
  assert.equal(child.component, "status-dashboard");
  assert.equal(child.operation, "build_dashboard_status");
  assert.equal(child.startedAt, "2026-05-13T00:00:00.000Z");
});

test("trace context round-trips through request headers", () => {
  const traceId = "1234567890abcdef1234567890abcdef";
  const parentSpanId = "1111111111111111";
  const context = traceContextFromHeaders({
    traceparent: `00-${traceId}-${parentSpanId}-01`,
    "X-Request-ID": "dash-req-7",
    "X-Parent-Span-ID": parentSpanId,
  });

  assert.equal(context.traceId, traceId);
  assert.equal(context.requestId, "dash-req-7");
  assert.equal(context.parentSpanId, parentSpanId);
  assert.deepEqual(traceHeaders(context), {
    "X-Request-ID": "dash-req-7",
    "X-Trace-ID": traceId,
    "X-Span-ID": context.spanId,
    "X-Parent-Span-ID": parentSpanId,
    traceparent: `00-${traceId}-${context.spanId}-01`,
  });
});

test("trace context rejects invalid inbound ids and falls back to generated safe values", () => {
  const context = traceContextFromHeaders({
    traceparent: "00-xyz-xyz-01",
    "X-Request-ID": "bad id with spaces",
    "X-Trace-ID": "not-hex",
    "X-Span-ID": "short",
  });

  assert.equal(isValidTraceId(context.traceId), true);
  assert.equal(context.requestId.startsWith("req-"), true);
  assert.equal(context.requestId.includes(" "), false);
  assert.equal(context.parentSpanId, null);
});

test("trace metadata drops sensitive attributes before logs use it", async () => {
  const stdout = captureStream();
  const context = createTraceContext({ boundary: "cli", name: "safe-report" });
  const logger = createLogger({
    component: "trace-test",
    stdout,
    stderr: captureStream(),
    traceContext: childTraceContext(context, { name: "child-log" }),
    now: () => "2026-05-13T00:00:00.000Z",
  });

  logger.info("trace_smoke", {
    traceAttributes: {
      privateKey: "must-not-appear",
      walletAddress: "0xabc",
    },
  });
  await logger.flush();

  const record = JSON.parse(stdout.writes[0]);
  assert.equal(record.trace.traceId, context.traceId);
  assert.equal(record.trace.walletAddress, "0xabc");
  assert.equal(Object.hasOwn(record.trace, "privateKey"), false);
});

test("trace context CLI emits one non-live propagated structured log", () => {
  const result = spawnSync(process.execPath, ["src/cli/check-trace-context.mjs", "--request-id=local-smoke"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  const record = JSON.parse(result.stdout.trim());
  assert.equal(record.component, "check-trace-context");
  assert.equal(record.event, "trace_context_check");
  assert.equal(record.trace.requestId, "local-smoke");
  assert.equal(record.propagatedHeaders["X-Request-ID"], "local-smoke");
  assert.equal(result.stderr, "");
});
