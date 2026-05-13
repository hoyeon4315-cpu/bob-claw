import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import {
  build0xCommand,
  buildProfileOutputDir,
  profileTargetIds,
  resolveProfileTarget,
  sanitizeProfileEnv,
} from "./profile-targets.mjs";

function parseCliArgs(argv = []) {
  const args = [...argv];
  let targetId = null;
  let outputDir = null;
  let listOnly = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--list") {
      listOnly = true;
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      outputDir = arg.slice("--output-dir=".length);
      continue;
    }
    if (arg === "--output-dir") {
      outputDir = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unsupported argument: ${arg}`);
    }
    if (targetId) {
      throw new Error("Only one profile target may be passed at a time.");
    }
    targetId = arg;
  }

  return { listOnly, targetId, outputDir };
}

function printTargetList() {
  for (const targetId of profileTargetIds()) {
    const profile = resolveProfileTarget(targetId);
    console.log(`${targetId}\t${profile.description}`);
  }
}

function main() {
  const { listOnly, targetId, outputDir } = parseCliArgs(process.argv.slice(2));
  if (listOnly) {
    printTargetList();
    return;
  }
  if (!targetId) {
    throw new Error("Usage: node scripts/run-profile-target.mjs [--list] <target-id> [--output-dir <dir>]");
  }

  const resolvedOutputDir = outputDir || buildProfileOutputDir(targetId);
  mkdirSync(resolvedOutputDir, { recursive: true });
  const { command, args } = build0xCommand(targetId, resolvedOutputDir);

  console.error(`Profiling ${targetId}`);
  console.error(`Output: ${resolvedOutputDir}`);
  console.error("Safety: profiling runs with a sanitized environment and a fixed non-live allowlist.");

  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: sanitizeProfileEnv(),
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  process.exitCode = Number.isInteger(result.status) ? result.status : 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
