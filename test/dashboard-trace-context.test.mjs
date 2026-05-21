import assert from "node:assert/strict";
import { test } from "node:test";

import { buildStatusDashboardTraceContext } from "../src/cli/status-dashboard.mjs";
import { buildDashboardStatus } from "../src/status/dashboard-status.mjs";

test("status dashboard creates a child trace span from explicit incoming ids", () => {
  const trace = buildStatusDashboardTraceContext({
    argv: ["--request-id=ops-run-7", "--trace-id=1234567890abcdef1234567890abcdef"],
    env: {},
    now: "2026-05-13T00:00:00.000Z",
  });

  assert.equal(trace.root.requestId, "ops-run-7");
  assert.equal(trace.root.traceId, "1234567890abcdef1234567890abcdef");
  assert.equal(trace.status.traceId, trace.root.traceId);
  assert.equal(trace.status.requestId, trace.root.requestId);
  assert.equal(trace.status.parentSpanId, trace.root.spanId);
  assert.equal(trace.status.component, "status-dashboard");
  assert.equal(trace.status.operation, "build_dashboard_status");
});

test("status dashboard propagates a sanitized trace envelope into dashboard status", () => {
  const trace = buildStatusDashboardTraceContext({
    argv: ["--request-id=bad id with spaces"],
    env: {},
    now: "2026-05-13T00:00:00.000Z",
  });
  const status = buildDashboardStatus(
    {},
    {
      now: "2026-05-13T00:00:00.000Z",
      traceContext: trace.status,
    },
  );

  assert.equal(status.observability.trace.traceId, trace.status.traceId);
  assert.equal(status.observability.trace.requestId.startsWith("req-"), true);
  assert.equal(status.observability.trace.parentSpanId, trace.root.spanId);
  assert.equal(status.observability.trace.component, "status-dashboard");
  assert.equal(status.observability.trace.operation, "build_dashboard_status");
  assert.equal(status.observability.trace.startedAt, "2026-05-13T00:00:00.000Z");
});
