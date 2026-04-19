import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function buildLiveReadinessRefreshPlan() {
  return [
    { script: "src/cli/run-current-route-prelive-pass.mjs", args: ["--execute", "--continue-on-failure"] },
    { script: "src/cli/hydrate-wrapped-btc-loop-live-proof.mjs", args: ["--write"] },
    { script: "src/cli/report-strategy-research-board.mjs", args: ["--write"] },
    { script: "src/cli/report-deterministic-strategy-candidates.mjs", args: ["--write"] },
    { script: "src/cli/report-strategy-snapshot.mjs", args: ["--write"] },
    { script: "src/cli/report-phase3-strategy-validation.mjs", args: ["--write"] },
    { script: "src/cli/report-allocator-core.mjs", args: ["--write"] },
    { script: "src/cli/report-protocol-market-watchers.mjs", args: ["--write"] },
    { script: "src/cli/validate-prelive-readiness.mjs", args: ["--write"] },
    { script: "src/cli/build-prelive-review-package.mjs", args: ["--write"] },
    { script: "src/cli/report-prelive-readiness.mjs", args: ["--write"] },
    { script: "src/cli/report-btc-only-e2e-dry-run.mjs", args: ["--write"] },
    { script: "src/cli/report-tiny-live-canary-rollout.mjs", args: ["--write"] },
    { script: "src/cli/report-live-ops-handoff.mjs", args: ["--write"] },
    { script: "src/cli/report-final-operator-explainer.mjs", args: ["--write"] },
    { script: "src/cli/write-session-handoff.mjs", args: [] },
  ];
}

export function summarizeLiveReadinessRefreshPlan(plan = buildLiveReadinessRefreshPlan()) {
  return plan.map(({ script, args = [] }) => `node ${script}${args.length ? ` ${args.join(" ")}` : ""}`);
}

function defaultRunStep(step) {
  const result = spawnSync(process.execPath, [resolve(ROOT, step.script), ...(step.args || [])], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const command = `node ${step.script}${step.args?.length ? ` ${step.args.join(" ")}` : ""}`;
    const error = new Error(`Command failed: ${command}`);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.step = step;
    throw error;
  }
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

export function runLiveReadinessRefreshPlan({
  plan = buildLiveReadinessRefreshPlan(),
  runStep = defaultRunStep,
} = {}) {
  return plan.map((step) => ({
    ...step,
    ...runStep(step),
  }));
}
