import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);
const sarifFormatterPath = require.resolve("@microsoft/eslint-formatter-sarif");

const result = spawnSync(
  "npx",
  ["eslint", ".", "--format", sarifFormatterPath, "--output-file", "eslint-results.sarif"],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
