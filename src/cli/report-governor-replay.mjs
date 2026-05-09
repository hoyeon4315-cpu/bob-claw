#!/usr/bin/env node
import { parseArgs } from "node:util";
import { buildGovernorReplay } from "../audit/governor-replay.mjs";
import { readSignerAuditLog } from "../executor/signer/audit-log.mjs";

const { values } = parseArgs({
  options: {
    json: { type: "boolean", default: false },
    markdown: { type: "boolean", default: false },
    "lookback-days": { type: "string" },
  },
});

const lookbackDays = Number(values["lookback-days"] || 30);
const auditRecords = await readSignerAuditLog();
const replay = buildGovernorReplay({
  auditRecords,
  lookbackDays: Number.isFinite(lookbackDays) ? lookbackDays : 30,
});

if (values.markdown) {
  process.stdout.write(replay.markdown);
} else if (values.json) {
  process.stdout.write(`${JSON.stringify(replay, null, 2)}\n`);
} else {
  console.log(`governorReplay wouldReject=${replay.summary.wouldRejectCount} avoidableGasUsd=${replay.summary.avoidableGasUsd}`);
  process.stdout.write(replay.markdown);
}
