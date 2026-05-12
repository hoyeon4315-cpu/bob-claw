import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { createLogger, isRestrictedStructuredLogPath, sanitizeLogFields } from "../src/logger.mjs";

function captureStream() {
  const writes = [];
  return {
    writes,
    write(line) {
      writes.push(line);
    },
  };
}

test("sanitizeLogFields redacts sensitive keys and payload-shaped secrets", () => {
  const sanitized = sanitizeLogFields({
    ok: true,
    nested: {
      privateKey: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      apiToken: "telegram-token-1234567890",
      burnerEvmKeyPath: "/Users/operator/.keys/burner-evm",
      rawSignedTx: "0x02f86c0180843b9aca00847735940082520894abcabcabcabcabcabcabcabcabcabcabcabcabca8080c0",
      publicNote: "safe text",
    },
    list: ["keep", { authorization: "Bearer abcdefghijklmnop" }],
  });

  const encoded = JSON.stringify(sanitized);
  assert.equal(sanitized.nested.publicNote, "safe text");
  assert.equal(sanitized.nested.privateKey, "[redacted]");
  assert.equal(sanitized.nested.apiToken, "[redacted]");
  assert.equal(sanitized.nested.burnerEvmKeyPath, "[redacted]");
  assert.equal(sanitized.nested.rawSignedTx, "[redacted]");
  assert.equal(sanitized.list[1].authorization, "[redacted]");
  assert.equal(encoded.includes("0123456789abcdef"), false);
  assert.equal(encoded.includes("telegram-token"), false);
  assert.equal(encoded.includes("/Users/operator/.keys"), false);
});

test("logger emits one structured JSON line with required fields", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const logger = createLogger({
    component: "structured-logger-test",
    stdout,
    stderr,
    now: () => "2026-05-12T00:00:00.000Z",
  });

  logger.info("smoke", { privateKey: "super-secret-value", count: 2n });
  await logger.flush();

  assert.equal(stderr.writes.length, 0);
  assert.equal(stdout.writes.length, 1);

  const record = JSON.parse(stdout.writes[0]);
  assert.equal(record.timestamp, "2026-05-12T00:00:00.000Z");
  assert.equal(record.level, "info");
  assert.equal(record.component, "structured-logger-test");
  assert.equal(record.event, "smoke");
  assert.equal(record.privateKey, "[redacted]");
  assert.equal(record.count, "2");
});

test("logger routes warn/error to stderr and filters below configured level", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const logger = createLogger({
    component: "structured-logger-test",
    level: "warn",
    stdout,
    stderr,
    now: () => "2026-05-12T00:00:00.000Z",
  });

  logger.info("suppressed", { value: 1 });
  logger.warn("visible", { value: 2 });
  await logger.flush();

  assert.equal(stdout.writes.length, 0);
  assert.equal(stderr.writes.length, 1);
  assert.equal(JSON.parse(stderr.writes[0]).event, "visible");
});

test("logger optionally appends observability JSONL without targeting audit logs", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-logger-"));
  try {
    const stdout = captureStream();
    const stderr = captureStream();
    const filePath = join(root, "observability", "dev-report.jsonl");
    const logger = createLogger({
      component: "structured-logger-test",
      stdout,
      stderr,
      filePath,
      now: () => "2026-05-12T00:00:00.000Z",
    });

    logger.info("file_append", { secret: "do-not-write" });
    await logger.flush();

    const lines = (await readFile(filePath, "utf8")).trim().split("\n");
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).secret, "[redacted]");

    assert.equal(isRestrictedStructuredLogPath(join(root, "logs", "signer-audit.jsonl")), true);
    assert.throws(
      () =>
        createLogger({
          component: "structured-logger-test",
          filePath: join(root, "logs", "signer-audit.jsonl"),
        }),
      /audit or receipt log/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("structured logger CLI emits a non-live JSONL smoke event", () => {
  const result = spawnSync(process.execPath, ["src/cli/check-structured-logger.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  const record = JSON.parse(result.stdout.trim());
  assert.equal(record.component, "check-structured-logger");
  assert.equal(record.event, "structured_logger_check");
  assert.equal(record.auditLogRole, "none_observability_only");
  assert.equal(result.stderr, "");
});
