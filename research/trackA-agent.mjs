#!/usr/bin/env node

import process from "node:process";

function parseArgs(argv) {
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...rest] = item.slice(2).split("=");
        return [key, rest.join("=")];
      }),
  );
  return {
    maxExperiments: options["max-experiments"] ? Number(options["max-experiments"]) : 1,
  };
}

function candidateBody(name) {
  return `export const metadata = {
  name: "${name}",
  track: "A",
  family: "momentum",
  event: "create",
  notes: "agent-generated momentum carry candidate"
};

export function buildSignals({ panel, helpers }) {
  const close = panel.rows.map((row) => row.close);
  const fast = helpers.sma(close, 4);
  const slow = helpers.sma(close, 11);
  return panel.rows.map((_, index) => fast[index] > slow[index] ? 1 : 0);
}
`;
}

const args = parseArgs(process.argv.slice(2));
const count = Math.max(1, Math.min(1, args.maxExperiments || 1));
const candidates = Array.from({ length: count }, (_, index) => ({
  name: `agent_momentum_bridge_${String(index + 1).padStart(2, "0")}`,
  body: candidateBody(`AgentMomentumBridge${index + 1}`),
}));

process.stdout.write(`${JSON.stringify({ candidates })}\n`);
