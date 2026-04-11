#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { config } from "../config/env.mjs";
import { loadCanaryState } from "../estimator/load-canary-state.mjs";

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
    address: options.address || config.estimateFrom,
  };
}

function runNodeScript(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const error = new Error(`Command failed: node ${script} ${args.join(" ")}`.trim());
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function routeArgs(address, route) {
  return [`--address=${address}`, `--route-key=${route.routeKey}`, `--amount=${route.amount}`];
}

function activeRoute(step, fallbackRoute = null) {
  return step?.route || fallbackRoute || null;
}

function printStep(step, prefix = "current") {
  console.log(`${prefix}Decision=${step.decision}`);
  console.log(`${prefix}Headline=${step.headline}`);
  if (step.route) {
    console.log(`${prefix}Route=${step.route.label} amount=${step.route.amount}`);
  }
  if (step.reasons?.length) {
    console.log(`${prefix}Reasons=${step.reasons.join(",")}`);
  }
  for (const action of step.actions || []) {
    if (action.type === "fund_native") {
      console.log(`${prefix}Action=fund ${action.shortfallDecimal} ${action.ticker} on ${action.chain}`);
    } else if (action.type === "fund_token") {
      console.log(`${prefix}Action=fund ${action.shortfallDecimal} ${action.ticker} on ${action.chain}`);
    } else if (action.type === "approve_allowance") {
      console.log(`${prefix}Action=approve ${action.shortfallDecimal} ${action.ticker} for ${action.spender} on ${action.chain}`);
    } else if (action.type === "estimate_exact_gas") {
      console.log(`${prefix}Action=estimate exact gas for ${action.routeKey} amount=${action.amount}`);
    } else if (action.type === "rerun_scoring") {
      console.log(`${prefix}Action=rerun scoring for ${action.routeKey} amount=${action.amount}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const initial = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
  let next = initial.nextStep;

  if (args.json) {
    const output = { initial: next, ran: [] };
    if (next.decision === "RUN_EXACT_GAS" || next.decision === "RERUN_SCORING") {
      let route = activeRoute(next);
      if (next.decision === "RUN_EXACT_GAS") {
        runNodeScript("src/cli/check-estimator-wallet.mjs", routeArgs(args.address, route));
        const refreshed = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
        next = refreshed.nextStep;
        output.afterWalletCheck = next;
        route = activeRoute(next, route);
        if (next.decision === "RUN_EXACT_GAS") {
          runNodeScript("src/cli/estimate-gateway-gas.mjs", [`--from=${args.address}`, `--route-key=${route.routeKey}`, `--amount=${route.amount}`]);
          output.ran.push("estimate-gateway-gas");
        }
      }
      runNodeScript("src/cli/score-gateway.mjs", ["--write"]);
      runNodeScript("src/cli/status-dashboard.mjs");
      output.ran.push("score-gateway", "status-dashboard");
      output.final = (await loadState(args.address)).nextStep;
    }
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  printStep(next, "current");

  if (next.decision === "FUND_AND_APPROVE_WALLET" || next.decision.startsWith("BLOCKED")) return;
  let route = activeRoute(next);
  if (!route) return;

  if (next.decision === "RUN_EXACT_GAS") {
    runNodeScript("src/cli/check-estimator-wallet.mjs", routeArgs(args.address, route));
    const afterWalletCheck = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
    next = afterWalletCheck.nextStep;
    printStep(next, "afterWalletCheck");
    route = activeRoute(next, route);
    if (next.decision !== "RUN_EXACT_GAS") return;

    runNodeScript("src/cli/estimate-gateway-gas.mjs", [`--from=${args.address}`, `--route-key=${route.routeKey}`, `--amount=${route.amount}`]);
  }

  runNodeScript("src/cli/score-gateway.mjs", ["--write"]);
  runNodeScript("src/cli/status-dashboard.mjs");
  const finalState = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
  printStep(finalState.nextStep, "final");
}

main().catch((error) => {
  console.error(error.stderr || error.stack || error.message);
  process.exitCode = 1;
});
