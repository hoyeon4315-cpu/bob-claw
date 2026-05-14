#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config/env.mjs";
import { readKillSwitchStatus } from "../executor/policy/kill-switch.mjs";
import { loadUnifiedOperatingCapital } from "../lib/unified-nav-reader.mjs";
import { buildCapitalAuditReport, collectCapitalAuditInputs } from "../audit/capital-audit.mjs";
import { fetchDefiLlamaPools } from "./report-campaign-aware-opportunities.mjs";
import { buildAllSourceDeploymentSelectorReport } from "../strategy/all-source-deployment-selector.mjs";
import { sendSignerCommand, signerSocketPath } from "../executor/signer/client.mjs";

const execFileAsync = promisify(execFile);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    json: false,
    execute: false,
    write: false,
    submitSigner: false,
    commandTimeoutMs: 180_000,
    socketPath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (raw === "--json") args.json = true;
    else if (raw === "--execute") args.execute = true;
    else if (raw === "--write") args.write = true;
    else if (raw === "--submit-signer") args.submitSigner = true;
    else if (raw.startsWith("--command-timeout-ms="))
      args.commandTimeoutMs = Number(raw.slice("--command-timeout-ms=".length));
    else if (raw === "--command-timeout-ms") {
      args.commandTimeoutMs = Number(argv[index + 1]);
      index += 1;
    } else if (raw.startsWith("--socket-path=")) {
      args.socketPath = raw.slice("--socket-path=".length);
    } else if (raw === "--socket-path") {
      args.socketPath = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function parseJson(stdout, label) {
  const raw = String(stdout || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} did not emit parseable JSON: ${error.message}`);
  }
}

async function runJsonNode(script, args = [], { timeout = 180_000 } = {}) {
  const { stdout } = await execFileAsync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    maxBuffer: 64 * 1024 * 1024,
    timeout,
  });
  return parseJson(stdout, script);
}

async function collectFreshInputs({ timeout }) {
  const capitalAuditInputs = await collectCapitalAuditInputs({ dataDir: config.dataDir });
  const capitalAudit = buildCapitalAuditReport(capitalAuditInputs);
  const [
    unifiedCapital,
    killStatus,
    merklOpportunities,
    merklQueue,
    campaignAware,
    strategyCatalog,
    executionSurfaces,
    allocatorCore,
    radarBoard,
    defiLlamaPools,
  ] = await Promise.all([
    loadUnifiedOperatingCapital({ dataDir: config.dataDir }).catch((error) => ({
      halt: true,
      unifiedNavUsd: null,
      flags: ["unified_capital_live_read_failed"],
      missingSources: [],
      error: error.message,
    })),
    readKillSwitchStatus().catch((error) => ({ halted: null, error: error.message })),
    runJsonNode("src/cli/report-merkl-opportunities.mjs", ["--json", "--write"], { timeout }),
    runJsonNode("src/cli/report-merkl-canary-queue.mjs", ["--json", "--write"], { timeout }),
    runJsonNode("src/cli/report-campaign-aware-opportunities.mjs", ["--json"], { timeout }),
    runJsonNode("src/cli/report-strategy-catalog.mjs", ["--json"], { timeout }),
    runJsonNode("src/cli/report-strategy-execution-surfaces.mjs", ["--json"], { timeout }),
    runJsonNode("src/cli/report-allocator-core.mjs", ["--json"], { timeout }),
    runJsonNode("src/cli/report-radar-board.mjs", ["--json"], { timeout }),
    fetchDefiLlamaPools().catch(() => []),
  ]);
  return {
    capitalAudit,
    unifiedCapital,
    killStatus,
    merklOpportunities,
    merklQueue,
    campaignAware,
    strategyCatalog,
    executionSurfaces,
    allocatorCore,
    radarBoard,
    defiLlamaPools,
  };
}

async function maybeSubmitSigner({ args, report }) {
  if (!args.submitSigner) return null;
  const intent = report.selection?.attemptedIntent;
  const candidate = report.selection?.selectedCandidate;
  if (!intent || candidate?.policyResult?.decision !== "ALLOW") {
    return {
      attempted: false,
      reason: "policy_not_allowed_or_no_intent",
    };
  }
  if (intent.intentType === "all_source_deployment_candidate") {
    return {
      attempted: false,
      reason: "lane_specific_signer_intent_builder_required",
      txHashes: [],
    };
  }
  const socketPath = args.socketPath || signerSocketPath();
  try {
    const result = await sendSignerCommand({
      socketPath,
      message: {
        command: "sign_and_broadcast",
        intent,
        awaitConfirmation: false,
        confirmations: 0,
        timeoutMs: args.commandTimeoutMs,
      },
      timeoutMs: args.commandTimeoutMs,
    });
    return {
      attempted: true,
      socketPath,
      result,
      txHashes: Array.isArray(result?.txHashes) ? result.txHashes : [],
    };
  } catch (error) {
    return {
      attempted: true,
      socketPath,
      error: error.message,
      txHashes: [],
    };
  }
}

async function main() {
  const args = parseArgs();
  const now = new Date().toISOString();
  const inputs = await collectFreshInputs({ timeout: args.commandTimeoutMs });
  const policyEvaluator = args.execute
    ? undefined
    : async ({ intent }) => ({
        decision: "BLOCK",
        blockers: ["selector_preview_no_policy_execute"],
        effectiveIntent: intent,
        results: [],
        strategyCaps: null,
      });
  const report = await buildAllSourceDeploymentSelectorReport({
    now,
    ...inputs,
    policyEvaluator,
  });
  const signerResult = await maybeSubmitSigner({ args, report });
  const output = {
    ...report,
    executionMode: {
      executePolicy: args.execute,
      submitSigner: args.submitSigner,
    },
    broadcast: signerResult
      ? {
          attempted: signerResult.attempted,
          txHashes: signerResult.txHashes || [],
          signerResult,
          noBroadcastReason:
            signerResult.txHashes?.length > 0
              ? null
              : signerResult.reason || signerResult.error || report.broadcast.noBroadcastReason,
        }
      : report.broadcast,
  };
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(`status=${output.status}`);
  console.log(`sourceCoverage=${output.sourceCoverage.map((row) => `${row.source}:${row.candidateCount}`).join(",")}`);
  console.log(`selection=${output.selection.status}`);
  console.log(`selectedStrategy=${output.selection.selectedCandidate?.strategyId || "none"}`);
  console.log(`expectedRealizedNetUsd=${output.selection.selectedCandidate?.expectedRealizedNetUsd ?? "n/a"}`);
  console.log(`noBroadcastReason=${output.broadcast.noBroadcastReason || "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
