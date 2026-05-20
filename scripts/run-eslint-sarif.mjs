import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const eslintBinPath = resolve(rootDir, "node_modules/eslint/bin/eslint.js");
const sarifFormatterPath = require.resolve("@microsoft/eslint-formatter-sarif");

const result = spawnSync(
  process.execPath,
  [eslintBinPath, ".", "--format", sarifFormatterPath, "--output-file", "eslint-results.sarif"],
  {
    cwd: rootDir,
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
