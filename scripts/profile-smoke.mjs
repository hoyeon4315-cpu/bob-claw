import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { DEFAULT_PROFILE_ARTIFACT_DIR } from "./profile-targets.mjs";

const smokeDir = join(DEFAULT_PROFILE_ARTIFACT_DIR, "smoke-check-tech-debt");
const result = spawnSync("node", ["scripts/run-profile-target.mjs", "check:tech-debt", "--output-dir", smokeDir], {
  cwd: process.cwd(),
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const flamegraphPath = join(smokeDir, "flamegraph.html");
if (!existsSync(flamegraphPath)) {
  throw new Error(`Expected profiling artifact at ${flamegraphPath}`);
}

console.log(`Profiling smoke succeeded: ${flamegraphPath}`);
