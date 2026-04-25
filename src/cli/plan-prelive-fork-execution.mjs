#!/usr/bin/env node

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { loadCanaryState, readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { GatewayClient } from "../gateway/client.mjs";
import { hydrateOfframpExecutionFromGatewayBody } from "../gateway/executable-quote.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { selectSimulationTargets } from "../prelive/execution-sim.mjs";
import { buildForkExecutionPlan } from "../prelive/fork-execution.mjs";

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
    write: flags.has("--write"),
    address: options.address || null,
    source: options.source || "objective",
    routeKey: options["route-key"] || null,
    amount: options.amount || null,
    limit: options.limit ? Number(options.limit) : 1,
  };
}

function selectionKey(routeKey, amount) {
  return routeKey && amount ? `${routeKey}|${amount}` : null;
}

function parseRouteKey(routeKey = null) {
  const [src = "", dst = ""] = String(routeKey || "").split("->");
  const [srcChain, srcToken] = src.split(":");
  const [dstChain, dstToken] = dst.split(":");
  if (!srcChain || !dstChain || !srcToken || !dstToken) return null;
  return { srcChain, srcToken, dstChain, dstToken };
}

function quoteParamsForExecution(route, amount, address) {
  const params = {
    srcChain: route.srcChain,
    dstChain: route.dstChain,
    srcToken: route.srcToken,
    dstToken: route.dstToken,
    amount,
    recipient: route.dstChain === "bitcoin" ? config.verifyBtcRecipient : address,
    slippage: config.slippageBps,
  };
  if (route.srcChain !== "bitcoin") {
    params.sender = address;
  }
  return params;
}

function normalizeQuoteBody(body = null) {
  return body?.onramp || body?.offramp || body?.layerZero || body || null;
}

export async function refreshSelectionExecutableQuote(
  selection,
  {
    address,
    client = new GatewayClient({ baseUrl: config.gatewayApiBase }),
    hydrateExecutionImpl = hydrateOfframpExecutionFromGatewayBody,
  } = {},
) {
  if (!selection?.routeKey || !selection?.amount || !address) return selection;
  const route = selection?.quote?.route || parseRouteKey(selection.routeKey);
  if (!route) return selection;
  const quoteResult = await client.getQuote(quoteParamsForExecution(route, selection.amount, address));
  const executable = await hydrateExecutionImpl(quoteResult.body, { client });
  const quoteBody = normalizeQuoteBody(quoteResult.body);
  return {
    ...selection,
    quote: {
      ...(selection.quote || {}),
      ...(quoteBody || {}),
      route,
      amount: selection.amount,
      sender: route.srcChain === "bitcoin" ? null : address,
      recipient: route.dstChain === "bitcoin" ? config.verifyBtcRecipient : address,
      txTo: executable.txTo ?? quoteBody?.tx?.to ?? quoteBody?.txTo ?? selection?.quote?.txTo ?? null,
      txData: executable.txData ?? quoteBody?.tx?.data ?? selection?.quote?.txData ?? null,
      txValueWei: executable.txValueWei ?? String(quoteBody?.tx?.value ?? selection?.quote?.txValueWei ?? 0),
      txChain: executable.txChain ?? quoteBody?.tx?.chain ?? selection?.quote?.txChain ?? null,
      txDataBytes:
        executable.txDataBytes ??
        (quoteBody?.tx?.data ? Math.max(0, (quoteBody.tx.data.length - 2) / 2) : selection?.quote?.txDataBytes ?? null),
    },
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { observedAt, generatedAt, ...stable } = value;
  return stable;
}

function planSelectionKey(plan = null) {
  return [plan?.routeKey || "", String(plan?.amount || ""), plan?.selectionSource || ""].join("|");
}

export function mergePlans(existingOutput = null, nextOutput = null, { preservePlanIds = new Set() } = {}) {
  const nextPlans = nextOutput?.plans || [];
  const existingPlans = existingOutput?.plans || [];
  const nextPlanIds = new Set(nextPlans.map((plan) => plan?.planId).filter(Boolean));
  const nextSelectionKeys = new Set(nextPlans.map((plan) => planSelectionKey(plan)));
  const mergedPlans = [
    ...nextPlans,
    ...existingPlans.filter((plan) => {
      if (nextPlanIds.has(plan?.planId)) return false;
      if (preservePlanIds.has(plan?.planId)) return true;
      if (nextSelectionKeys.has(planSelectionKey(plan))) return false;
      return true;
    }),
  ];
  const sourceSet = new Set(
    [
      ...(existingOutput?.source ? [existingOutput.source] : []),
      ...(nextOutput?.source ? [nextOutput.source] : []),
    ].filter(Boolean),
  );
  return {
    ...nextOutput,
    source: sourceSet.size === 1 ? [...sourceSet][0] : "mixed",
    selectedCount: mergedPlans.length,
    plans: mergedPlans,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resolved = await resolveOperationalAddress({ explicitAddress: args.address, dataDir: config.dataDir });
  const state = await loadCanaryState({ address: resolved.address, dataDir: config.dataDir });
  const [shadowCycle, refreshPlan] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "shadow-cycle-latest.json")),
    readJsonIfExists(join(config.dataDir, "shadow-refresh-plan.json")),
  ]);
  const walletReadiness = await readJsonl(config.dataDir, "estimator-wallet-readiness");
  const scoreBySelection = new Map(
    (state.scoreSnapshot?.scores || []).map((score) => [selectionKey(score.routeKey, score.amount), score]),
  );
  const selections = selectSimulationTargets({
    quotes: state.quotes || [],
    walletReadiness,
    address: resolved.address,
    refreshPlan,
    shadowCycle,
    source: args.routeKey ? "exact" : args.source,
    routeKey: args.routeKey,
    amount: args.amount,
    limit: args.limit,
  }).map((selection) => ({
    ...selection,
    score: scoreBySelection.get(selectionKey(selection.routeKey, selection.amount)) || null,
  }));
  const hydratedSelections = await Promise.all(
    selections.map(async (selection) => {
      if (!args.routeKey) return selection;
      try {
        return await refreshSelectionExecutableQuote(selection, { address: resolved.address });
      } catch {
        return selection;
      }
    }),
  );

  const plans = hydratedSelections.map((selection) =>
    buildForkExecutionPlan({
      selection,
      address: resolved.address,
    }),
  );
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    address: resolved.address,
    addressSource: resolved.source,
    source: args.routeKey ? "exact_route" : args.source,
    selectedCount: plans.length,
    plans,
  };

  if (args.write) {
    const outputPath = join(config.dataDir, "prelive-fork-plan.json");
    const [existingOutput, existingSubmissions, existingReceipts] = await Promise.all([
      readJsonIfExists(outputPath),
      readJsonl(config.dataDir, "prelive-fork-submissions"),
      readJsonl(config.dataDir, "prelive-fork-receipts"),
    ]);
    const preservePlanIds = new Set(
      [...existingSubmissions, ...existingReceipts].map((record) => record?.planId).filter(Boolean),
    );
    const mergedOutput = mergePlans(existingOutput, output, { preservePlanIds });
    await writeTextIfChanged(outputPath, `${JSON.stringify(mergedOutput, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`selectedCount=${output.selectedCount}`);
  for (const plan of plans) {
    console.log(
      [
        `planId=${plan.planId}`,
        `status=${plan.status}`,
        `route=${plan.routeLabel || plan.routeKey || "unknown"}`,
        `amount=${plan.amount || "n/a"}`,
        `source=${plan.selectionSource || "unknown"}`,
        `code=${plan.selectionCode || "unknown"}`,
        plan.blockers.length ? `blockers=${plan.blockers.join(",")}` : null,
        plan.commands.submit ? `submit=${plan.commands.submit}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryUrl && import.meta.url === entryUrl) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
