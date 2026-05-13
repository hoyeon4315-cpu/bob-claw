import test from "node:test";
import assert from "node:assert/strict";
import {
  SAFE_PROFILE_TARGETS,
  build0xCommand,
  buildProfileOutputDir,
  profileTargetIds,
  resolveProfileTarget,
  sanitizeProfileEnv,
} from "../scripts/profile-targets.mjs";

test("profile target ids stay sorted and non-empty", () => {
  const ids = profileTargetIds();
  assert.ok(ids.length > 0);
  assert.deepEqual(
    ids,
    [...ids].sort((left, right) => left.localeCompare(right)),
  );
});

test("allowed targets resolve to concrete commands", () => {
  for (const targetId of profileTargetIds()) {
    const profile = resolveProfileTarget(targetId);
    assert.equal(profile.targetId, targetId);
    assert.ok(Array.isArray(profile.command));
    assert.ok(profile.command.length >= 2);
  }
});

test("unsupported targets are rejected", () => {
  assert.throws(() => resolveProfileTarget("executor:daemon"), /Unsupported profile target/);
});

test("0x command keeps profiling scoped to allowed targets", () => {
  const outputDir = buildProfileOutputDir("dashboard:build", "2026-05-13T00:00:00.000Z");
  const invocation = build0xCommand("dashboard:build", outputDir);
  assert.match(invocation.command, /node_modules\/0x\/cmd\.js$/);
  assert.ok(invocation.args.includes("--output-dir"));
  assert.ok(invocation.args.includes(outputDir));
  assert.ok(invocation.args.includes("--"));
  assert.deepEqual(
    invocation.args.slice(-SAFE_PROFILE_TARGETS["dashboard:build"].command.length),
    SAFE_PROFILE_TARGETS["dashboard:build"].command,
  );
});

test("sanitized profiling environment removes secret-like variables", () => {
  const sanitized = sanitizeProfileEnv({
    PATH: "/usr/bin",
    HOME: "/tmp/home",
    TELEGRAM_BOT_TOKEN: "secret",
    OPENAI_API_KEY_PATH: "/tmp/key",
    BURNER_EVM_KEY_PATH: "/tmp/evm-key",
    NORMAL_FLAG: "keep",
  });
  assert.equal(sanitized.PATH, "/usr/bin");
  assert.equal(sanitized.HOME, "/tmp/home");
  assert.equal(sanitized.NORMAL_FLAG, "keep");
  assert.equal("TELEGRAM_BOT_TOKEN" in sanitized, false);
  assert.equal("OPENAI_API_KEY_PATH" in sanitized, false);
  assert.equal("BURNER_EVM_KEY_PATH" in sanitized, false);
});
