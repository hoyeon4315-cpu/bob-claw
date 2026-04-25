#!/usr/bin/env node

import { join } from "node:path";
import { spawn } from "node:child_process";

function parseValue(raw) {
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function parseArgs(argv) {
  const templateIdArg = argv.find((arg) => arg.startsWith("--template-id="));
  const setJsonArg = argv.find((arg) => arg.startsWith("--set-json="));
  const setArgs = argv.filter((arg) => arg.startsWith("--set="));
  const payload = {
    ...(setJsonArg ? JSON.parse(setJsonArg.slice("--set-json=".length)) : {}),
  };

  for (const arg of setArgs) {
    const body = arg.slice("--set=".length);
    const index = body.indexOf("=");
    if (index === -1) throw new Error(`Invalid --set argument: ${arg}`);
    payload[body.slice(0, index)] = parseValue(body.slice(index + 1));
  }

  return {
    write: argv.includes("--write"),
    templateId: templateIdArg ? templateIdArg.slice("--template-id=".length) : null,
    payload,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.templateId) throw new Error("Missing --template-id");
  if (Object.keys(args.payload).length === 0) throw new Error("Missing economics fields");

  const childArgs = [
    join(process.cwd(), "src/cli/set-destination-input-override.mjs"),
    `--template-id=${args.templateId}`,
    `--set-json=${JSON.stringify(args.payload)}`,
  ];

  if (args.write) childArgs.push("--write");

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
