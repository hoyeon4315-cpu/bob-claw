#!/usr/bin/env node

import { join } from "node:path";
import { spawn } from "node:child_process";

function parseArgs(argv) {
  const templateIdArg = argv.find((arg) => arg.startsWith("--template-id="));
  const decisionArg = argv.find((arg) => arg.startsWith("--decision="));
  const noteArg = argv.find((arg) => arg.startsWith("--note="));
  return {
    write: argv.includes("--write"),
    templateId: templateIdArg ? templateIdArg.slice("--template-id=".length) : null,
    decision: decisionArg ? decisionArg.slice("--decision=".length) : null,
    note: noteArg ? noteArg.slice("--note=".length) : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.templateId) throw new Error("Missing --template-id");
  if (!args.decision) throw new Error("Missing --decision");

  const payload = {
    allowlistDecision: args.decision,
  };

  if (args.note) {
    payload.allowlistNote = args.note;
  }

  const childArgs = [
    join(process.cwd(), "src/cli/set-destination-input-override.mjs"),
    `--template-id=${args.templateId}`,
    `--set-json=${JSON.stringify(payload)}`,
  ];

  if (args.write) {
    childArgs.push("--write");
  }

  const child = spawn("node", childArgs, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });

  await new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`set-destination-input-override exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
