import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { "dry-run": { type: "boolean" } },
  allowPositionals: true,
});

console.log("rotate:positions — planner + intent emission (stub)");
console.log(JSON.stringify({ status: "live", migrations: [], dryRun: values["dry-run"] || false, note: "PR 14 enabled" }));
