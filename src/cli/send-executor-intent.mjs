#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { sendSignerCommand, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";

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
    stdin: flags.has("--stdin"),
    file: options.file || null,
    command: options.command || "sign_and_broadcast",
    socketPath: options["socket-path"] || signerSocketPath(),
    timeoutMs: options["timeout-ms"] ? Number(options["timeout-ms"]) : signerClientTimeoutMs(),
    awaitConfirmation: !flags.has("--no-await-confirmation"),
    confirmations: options.confirmations ? Number(options.confirmations) : 1,
    confirmationTimeoutMs: options["confirmation-timeout-ms"] ? Number(options["confirmation-timeout-ms"]) : 120_000,
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readPayload(args) {
  if (args.command === "health") {
    return {
      command: "health",
    };
  }
  const raw = args.stdin ? await readStdin() : args.file ? await readFile(args.file, "utf8") : null;
  if (!raw) {
    throw new Error("Either --file=<path> or --stdin is required");
  }
  const parsed = JSON.parse(raw);
  if (parsed?.command && parsed?.intent) {
    return parsed;
  }
  return {
    command: args.command,
    intent: parsed,
    awaitConfirmation: args.awaitConfirmation,
    confirmations: args.confirmations,
    timeoutMs: args.confirmationTimeoutMs,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const message = await readPayload(args);
  const result = await sendSignerCommand({
    message,
    socketPath: args.socketPath,
    timeoutMs: args.timeoutMs,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`status=${result.status || "unknown"}`);
  if (result.error?.message) console.log(`error=${result.error.message}`);
  if (result.broadcast?.txHash) console.log(`txHash=${result.broadcast.txHash}`);
  if (result.receipt?.blockNumber) console.log(`blockNumber=${result.receipt.blockNumber}`);
  if (result.autoIngest) console.log(`autoIngest=${result.autoIngest.ran ? "ran" : result.autoIngest.reason || "skipped"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
