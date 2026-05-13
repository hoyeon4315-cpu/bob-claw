import assert from "node:assert/strict";
import { test } from "node:test";

import { buildErrorIssuePayload, redactSensitiveText } from "../src/observability/error-to-issue.mjs";

const SAMPLE_SECRET_TEXT =
  "privateKey=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef " +
  `token=ghp_${"a".repeat(32)} ` +
  "wallet=0x1111111111111111111111111111111111111111 " +
  "tx=0x2222222222222222222222222222222222222222222222222222222222222222 " +
  "btc=bc1p809tstru8s6x7accmac2xl3rczcfzzh96myh09gy68d883y4uzushkyww0 " +
  "keyPath=/Users/love/.keys/burner-evm.key";

test("redactSensitiveText removes secrets, wallet addresses, tx hashes, and key paths", () => {
  const redacted = redactSensitiveText(SAMPLE_SECRET_TEXT);

  assert.match(redacted, /\[REDACTED_[A-Z_]+\]/u);
  assert.doesNotMatch(redacted, /0123456789abcdef/u);
  assert.doesNotMatch(redacted, /ghp_/u);
  assert.doesNotMatch(redacted, /0x1111111111111111111111111111111111111111/u);
  assert.doesNotMatch(redacted, /0x2222222222222222222222222222222222222222222222222222222222222222/u);
  assert.doesNotMatch(redacted, /bc1p809t/u);
  assert.doesNotMatch(redacted, /\/Users\/love\/\.keys/u);
});

test("buildErrorIssuePayload turns a sanitized report into an actionable issue payload", () => {
  const payload = buildErrorIssuePayload({
    component: "status-dashboard",
    errorClass: "TypeError",
    message: `Failed to render dashboard with ${SAMPLE_SECRET_TEXT}`,
    severity: "error",
    stack: [
      "TypeError: Failed to render dashboard",
      "    at buildDashboardStatus (/Users/love/BOB Claw/src/status/dashboard-status.mjs:42:7)",
      "    at main (/Users/love/BOB Claw/src/cli/status-dashboard.mjs:12:3)",
    ].join("\n"),
    context: {
      route: "status:dashboard",
      intentHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
      BURNER_EVM_KEY_PATH: "/Users/love/.keys/burner-evm.key",
      telegramToken: "123456:ABCDEF-secret-token",
    },
    evidence: ["npm run status:dashboard failed locally"],
    observedAt: "2026-05-12T21:00:00.000Z",
  });

  assert.equal(payload.dryRunDefault, true);
  assert.match(payload.title, /^\[error-to-insight\] status-dashboard TypeError /u);
  assert.match(payload.title, /\([a-f0-9]{12}\)$/u);
  assert.deepEqual(payload.labels, ["type/bug", "area/runtime", "readiness/blocker"]);
  assert.match(payload.body, /## Summary/u);
  assert.match(payload.body, /## Affected component/u);
  assert.match(payload.body, /## Sanitized stack\/context/u);
  assert.match(payload.body, /## Reproduction\/evidence/u);
  assert.match(payload.body, /## Safety impact/u);
  assert.match(payload.body, /## Next checks/u);
  assert.match(payload.body, /## Secret-safety warning/u);
  assert.match(payload.body, /error-fingerprint: [a-f0-9]{16}/u);
  assert.doesNotMatch(JSON.stringify(payload), /0123456789abcdef/u);
  assert.doesNotMatch(JSON.stringify(payload), /ghp_/u);
  assert.doesNotMatch(JSON.stringify(payload), /0x1111111111111111111111111111111111111111/u);
  assert.doesNotMatch(JSON.stringify(payload), /0x2222222222222222222222222222222222222222222222222222222222222222/u);
  assert.doesNotMatch(JSON.stringify(payload), /0x3333333333333333333333333333333333333333333333333333333333333333/u);
  assert.doesNotMatch(JSON.stringify(payload), /bc1p809t/u);
  assert.doesNotMatch(JSON.stringify(payload), /\/Users\/love\/\.keys/u);
});
