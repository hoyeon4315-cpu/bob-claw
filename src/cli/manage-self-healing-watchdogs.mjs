#!/usr/bin/env node
// Launchd manager for self-healing watchdog cadence.
// Installs missing launchd entries without clobbering existing ones.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { homedir } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defaultLaunchAgentsDir, defaultLaunchdLogDir, renderLaunchAgentPlist } from "../runtime/launchd.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { resolveNodeExecutable } from "../runtime/node-path.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set(argv);
  return {
    install: flags.has("--install"),
    print: flags.has("--print"),
    json: flags.has("--json"),
    rootDir: process.cwd(),
    nodePath: resolveNodeExecutable(),
    launchAgentsDir: defaultLaunchAgentsDir(),
    logDir: defaultLaunchdLogDir(process.cwd()),
  };
}

function buildSpecs(options) {
  const sharedEnv = {
    PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
    HOME: process.env.HOME || homedir(),
  };

  return [
    {
      id: "capital-audit-backfill",
      label: "com.bobclaw.capital-audit-backfill",
      description: "Capital audit pair backfill watchdog",
      scriptPath: resolve(options.rootDir, "src/cli/backfill-capital-audit-pairs.mjs"),
      plistPath: resolve(options.launchAgentsDir, "com.bobclaw.capital-audit-backfill.plist"),
      stdoutPath: resolve(options.logDir, "capital-audit-backfill.out.log"),
      stderrPath: resolve(options.logDir, "capital-audit-backfill.err.log"),
      workingDirectory: resolve(options.rootDir),
      programArguments: [
        resolve(options.nodePath),
        resolve(options.rootDir, "src/cli/backfill-capital-audit-pairs.mjs"),
        "--write",
      ],
      environmentVariables: sharedEnv,
      runAtLoad: true,
      keepAlive: false,
      startInterval: 300,
      throttleInterval: 30,
      processType: "Background",
    },
    {
      id: "async-settlement-watcher",
      label: "com.bobclaw.async-settlement-watcher",
      description: "Async settlement and signer confirmation watcher",
      scriptPath: resolve(options.rootDir, "src/cli/run-async-settlement-watcher.mjs"),
      plistPath: resolve(options.launchAgentsDir, "com.bobclaw.async-settlement-watcher.plist"),
      stdoutPath: resolve(options.logDir, "async-settlement-watcher.out.log"),
      stderrPath: resolve(options.logDir, "async-settlement-watcher.err.log"),
      workingDirectory: resolve(options.rootDir),
      programArguments: [
        resolve(options.nodePath),
        resolve(options.rootDir, "src/cli/run-async-settlement-watcher.mjs"),
        "--write",
      ],
      environmentVariables: sharedEnv,
      runAtLoad: true,
      keepAlive: false,
      startInterval: 300,
      throttleInterval: 30,
      processType: "Background",
    },
    {
      id: "idle-consolidation",
      label: "com.bobclaw.idle-consolidation",
      description: "Idle inventory consolidation planner",
      scriptPath: resolve(options.rootDir, "src/cli/run-idle-consolidation.mjs"),
      plistPath: resolve(options.launchAgentsDir, "com.bobclaw.idle-consolidation.plist"),
      stdoutPath: resolve(options.logDir, "idle-consolidation.out.log"),
      stderrPath: resolve(options.logDir, "idle-consolidation.err.log"),
      workingDirectory: resolve(options.rootDir),
      programArguments: [
        resolve(options.nodePath),
        resolve(options.rootDir, "src/cli/run-idle-consolidation.mjs"),
        "--write",
      ],
      environmentVariables: sharedEnv,
      runAtLoad: true,
      keepAlive: false,
      startInterval: 3600,
      throttleInterval: 30,
      processType: "Background",
    },
    {
      id: "readiness-snapshot",
      label: "com.bobclaw.readiness-snapshot",
      description: "Full automation readiness snapshot",
      scriptPath: resolve(options.rootDir, "src/cli/check-full-automation-readiness.mjs"),
      plistPath: resolve(options.launchAgentsDir, "com.bobclaw.readiness-snapshot.plist"),
      stdoutPath: resolve(options.logDir, "readiness-snapshot.out.log"),
      stderrPath: resolve(options.logDir, "readiness-snapshot.err.log"),
      workingDirectory: resolve(options.rootDir),
      programArguments: [
        resolve(options.nodePath),
        resolve(options.rootDir, "src/cli/check-full-automation-readiness.mjs"),
        "--json",
      ],
      environmentVariables: sharedEnv,
      runAtLoad: true,
      keepAlive: false,
      startInterval: 600,
      throttleInterval: 30,
      processType: "Background",
    },
    {
      id: "inbound-inventory-watcher",
      label: "com.bobclaw.inbound-inventory-watcher",
      description: "Inbound inventory watcher loop",
      scriptPath: resolve(options.rootDir, "src/cli/run-inbound-inventory-watcher.mjs"),
      plistPath: resolve(options.launchAgentsDir, "com.bobclaw.inbound-inventory-watcher.plist"),
      stdoutPath: resolve(options.logDir, "inbound-inventory-watcher.out.log"),
      stderrPath: resolve(options.logDir, "inbound-inventory-watcher.err.log"),
      workingDirectory: resolve(options.rootDir),
      programArguments: [
        resolve(options.nodePath),
        resolve(options.rootDir, "src/cli/run-inbound-inventory-watcher.mjs"),
        "--loop",
      ],
      environmentVariables: sharedEnv,
      runAtLoad: true,
      keepAlive: true,
      throttleInterval: 30,
      processType: "Background",
    },
  ];
}

async function main() {
  const args = parseArgs();
  const specs = buildSpecs(args);

  if (args.print) {
    if (args.json) {
      console.log(
        JSON.stringify({ specs: specs.map((s) => ({ id: s.id, label: s.label, plistPath: s.plistPath })) }, null, 2),
      );
      return;
    }
    for (const spec of specs) {
      console.log(`### ${spec.id} (${spec.label})`);
      console.log(renderLaunchAgentPlist(spec));
    }
    return;
  }

  const writes = [];
  for (const spec of specs) {
    const result = await writeTextIfChanged(spec.plistPath, renderLaunchAgentPlist(spec));
    writes.push({ id: spec.id, changed: result.changed, plistPath: spec.plistPath });
  }

  if (args.json) {
    console.log(JSON.stringify({ writes }, null, 2));
    return;
  }

  for (const w of writes) {
    console.log(`write:${w.id}=changed:${w.changed} plist:${w.plistPath}`);
  }

  if (args.install) {
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    if (!Number.isInteger(uid)) {
      console.error("install requires numeric uid");
      process.exitCode = 1;
      return;
    }
    for (const spec of specs) {
      spawnSync("launchctl", ["bootout", `gui/${uid}/${spec.label}`], { encoding: "utf8" });
      spawnSync("launchctl", ["bootstrap", `gui/${uid}`, spec.plistPath], { encoding: "utf8" });
      console.log(`installed=${spec.label}`);
    }
  }
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
