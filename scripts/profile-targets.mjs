import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DEFAULT_PROFILE_ARTIFACT_DIR = resolve(ROOT_DIR, "artifacts/profiling");

const DEPCRUISE_BIN = resolve(ROOT_DIR, "node_modules/dependency-cruiser/bin/dependency-cruise.mjs");
const require = createRequire(import.meta.url);
const ZEROX_PACKAGE_JSON = require.resolve("0x/package.json");
const ZEROX_BIN = resolve(dirname(ZEROX_PACKAGE_JSON), "cmd.js");

export const SAFE_PROFILE_TARGETS = Object.freeze({
  "check:dead-code": {
    description: "Profiles the dead-code readiness scan.",
    command: ["node", "scripts/check-dead-code.mjs"],
  },
  "check:tech-debt": {
    description: "Profiles the tech-debt readiness scan.",
    command: ["node", "scripts/check-tech-debt.mjs"],
  },
  "check:duplicate-code": {
    description: "Profiles the duplicate-code readiness scan.",
    command: ["node", "scripts/check-duplicate-code.mjs"],
  },
  "check:architecture": {
    description: "Profiles the dependency-cruiser architecture scan.",
    command: ["node", DEPCRUISE_BIN, "src", "scripts", "test", "dashboard/public"],
  },
  "dashboard:build": {
    description: "Profiles the read-only dashboard build.",
    command: ["node", "src/cli/build-dashboard-public.mjs"],
  },
  "test:unit": {
    description: "Profiles the unit-test suite without integration launchers.",
    command: ["node", "--test", "test/*.test.mjs"],
  },
});

const SENSITIVE_ENV_PATTERNS = [
  /(^|_)SECRET($|_)/iu,
  /(^|_)TOKEN($|_)/iu,
  /(^|_)PASSWORD($|_)/iu,
  /(^|_)PRIVATE($|_)/iu,
  /(^|_)MNEMONIC($|_)/iu,
  /(^|_)SIGNATURE($|_)/iu,
  /(^|_)TELEGRAM($|_)/iu,
  /^BURNER_(?:EVM|BTC)_KEY_PATH$/iu,
  /^BURNER_PRIVATE_KEY_PATH$/iu,
  /^OPENAI_API_KEY(?:_PATH)?$/iu,
  /^ANTHROPIC_API_KEY(?:_PATH)?$/iu,
  /^COHERE_API_KEY(?:_PATH)?$/iu,
  /^GOOGLE_API_KEY(?:_PATH)?$/iu,
  /^AWS_(?:SECRET_ACCESS_KEY|SESSION_TOKEN)$/iu,
];

export function profileTargetIds() {
  return Object.keys(SAFE_PROFILE_TARGETS).sort((left, right) => left.localeCompare(right));
}

export function resolveProfileTarget(targetId) {
  const profile = SAFE_PROFILE_TARGETS[targetId];
  if (!profile) {
    const allowed = profileTargetIds().join(", ");
    throw new Error(`Unsupported profile target "${targetId}". Allowed targets: ${allowed}`);
  }
  return {
    ...profile,
    targetId,
  };
}

export function sanitizeProfileEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !SENSITIVE_ENV_PATTERNS.some((pattern) => pattern.test(key))),
  );
}

export function slugifyTargetId(targetId = "profile") {
  return (
    String(targetId)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "profile"
  );
}

export function buildProfileOutputDir(targetId, stamp = new Date()) {
  const timestamp = stamp instanceof Date ? stamp.toISOString() : new Date(stamp || Date.now()).toISOString();
  return join(DEFAULT_PROFILE_ARTIFACT_DIR, `${timestamp.replace(/[:.]/g, "-")}-${slugifyTargetId(targetId)}`);
}

export function build0xCommand(targetId, outputDir) {
  const profile = resolveProfileTarget(targetId);
  return {
    command: ZEROX_BIN,
    args: [
      "--quiet",
      "--working-dir",
      ROOT_DIR,
      "--output-dir",
      outputDir,
      "--title",
      `BOB Claw profiling: ${targetId}`,
      "--",
      ...profile.command,
    ],
    profile,
  };
}
