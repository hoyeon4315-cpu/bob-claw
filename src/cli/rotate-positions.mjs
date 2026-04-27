import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { "dry-run": { type: "boolean" } },
  allowPositionals: true,
});

console.log("rotate:positions — planner + intent emission (stub)");
console.log(JSON.stringify({ status: "stub", migrations: [], dryRun: values["dry-run"] || false, note: "enable in PR 13" }));
