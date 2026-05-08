#!/usr/bin/env node

import { main } from "./run-all-chain-autopilot.mjs";

const argv = process.argv.slice(2);
const effectiveArgv = argv.includes("--dry-run-idle") && !argv.includes("--json")
  ? [...argv, "--json"]
  : argv;

main(effectiveArgv).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
