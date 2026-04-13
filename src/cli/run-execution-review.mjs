#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    execute: flags.has("--execute"),
    write: flags.has("--write"),
    address: options.address || null,
    routeKey: options["route-key"] || null,
    amount: options.amount || null,
    continueOnError: flags.has("--continue-on-error"),
  };
}

function sameSelection(plan, routeKey, amount) {
  if (!routeKey && !amount) return true;
  return plan?.routeKey === routeKey && String(plan?.amount) === String(amount);
}

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value)
    .filter(([key]) => key !== "generatedAt" && key !== "startedAt" && key !== "finishedAt" && key !== "observedAt")
    .map(([key, nested]) => [key, stripVolatile(nested)]);
  return Object.fromEntries(entries);
}

function tokenizeCommand(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (const char of command) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping) current += "\\";
  if (quote) throw new Error(`Unterminated quote in command: ${command}`);
  if (current) tokens.push(current);
  return tokens;
}

function runCommand(command) {
  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) {
    throw new Error(`Cannot execute empty command: ${command}`);
  }
  const startedAt = new Date().toISOString();
  const result = spawnSync(tokens[0], tokens.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  const finishedAt = new Date().toISOString();
  return {
    command,
    startedAt,
    finishedAt,
    ok: result.status === 0,
    exitCode: result.status,
    stdout: result.stdout?.trim() || "",
    stderr: result.stderr?.trim() || "",
  };
}

async function loadExecutionReview(address) {
  const context = await buildCurrentDashboardContext({ dataDir: config.dataDir, address });
  return {
    context,
    plan: context.dashboardStatus?.shadowCycle?.objectivePlans?.executionReview || null,
  };
}

async function writeArtifact(payload) {
  const outputPath = join(config.dataDir, "execution-review-latest.json");
  await writeTextIfChanged(outputPath, `${JSON.stringify(payload, null, 2)}\n`, {
    normalize: (contents) => {
      if (!contents) return contents;
      return JSON.stringify(stripVolatile(JSON.parse(contents)));
    },
  });
  return outputPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resolved = await resolveOperationalAddress({ explicitAddress: args.address, dataDir: config.dataDir });
  const initial = await loadExecutionReview(resolved.address);
  const plan = initial.plan;

  if (!plan) {
    throw new Error("No execution review plan is available in the current shadow cycle");
  }
  if (!sameSelection(plan, args.routeKey, args.amount)) {
    throw new Error(`Execution review selection mismatch: expected ${plan.routeKey} amount=${plan.amount}`);
  }

  const steps = (plan.steps || []).map((step) => ({
    code: step.code || null,
    label: step.label || null,
    command: step.command || null,
    status: step.command ? "pending" : "skipped_no_command",
  }));

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    address: resolved.address,
    addressSource: resolved.source,
    execute: args.execute,
    routeKey: plan.routeKey,
    amount: plan.amount,
    label: plan.label || null,
    selectionCode: plan.selectionCode || null,
    selectionLabel: plan.selectionLabel || null,
    nextActionCode: plan.nextActionCode || null,
    nextActionLabel: plan.nextActionLabel || null,
    tradeReadiness: plan.tradeReadiness || null,
    measuredNetUsd: plan.measuredNetUsd ?? null,
    scoreNetUsd: plan.scoreNetUsd ?? null,
    executableNetUsd: plan.executableNetUsd ?? null,
    blockers: plan.blockers || [],
    blockerLabels: plan.blockerLabels || [],
    reasonLabels: plan.reasonLabels || [],
    hypothesisGuard: plan.hypothesisGuard || null,
    stepCount: steps.length,
    steps,
    results: [],
    completedStepCount: 0,
    failedStepCount: 0,
    finalStatus: "planned",
  };

  if (args.execute) {
    for (const step of output.steps) {
      if (!step.command) continue;
      const result = runCommand(step.command);
      output.results.push({
        code: step.code,
        label: step.label,
        ...result,
      });
      step.status = result.ok ? "completed" : "failed";
      output.completedStepCount += result.ok ? 1 : 0;
      output.failedStepCount += result.ok ? 0 : 1;
      if (!result.ok && !args.continueOnError) {
        output.finalStatus = "failed";
        break;
      }
    }
    if (output.finalStatus !== "failed") {
      output.finalStatus = output.failedStepCount > 0 ? "completed_with_failures" : "completed";
    }
  }

  let refreshed = null;
  if (args.execute) {
    refreshed = await loadExecutionReview(resolved.address);
    output.refreshedPlan = refreshed.plan
      ? {
          routeKey: refreshed.plan.routeKey,
          amount: refreshed.plan.amount,
          tradeReadiness: refreshed.plan.tradeReadiness || null,
          nextActionCode: refreshed.plan.nextActionCode || null,
          nextActionLabel: refreshed.plan.nextActionLabel || null,
          blockers: refreshed.plan.blockers || [],
        }
      : null;
  }

  let artifactPath = null;
  if (args.write || args.execute) {
    artifactPath = await writeArtifact(output);
  }

  if (args.json) {
    console.log(JSON.stringify({ ...output, artifactPath }, null, 2));
    return;
  }

  console.log(`route=${output.label || output.routeKey}`);
  console.log(`amount=${output.amount}`);
  console.log(`selection=${output.selectionCode || "unknown"}`);
  console.log(`nextAction=${output.nextActionCode || "unknown"}`);
  console.log(`stepCount=${output.stepCount}`);
  console.log(`status=${output.finalStatus}`);
  if (artifactPath) console.log(`wrote=${artifactPath}`);
  for (const step of output.steps) {
    console.log(
      [
        `step=${step.code || "unknown"}`,
        `label=${step.label || "unknown"}`,
        `status=${step.status}`,
        step.command ? `command=${step.command}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  if (output.results.length > 0) {
    for (const result of output.results) {
      console.log(
        [
          `result=${result.code || "unknown"}`,
          `ok=${result.ok}`,
          `exitCode=${result.exitCode}`,
        ].join(" "),
      );
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
