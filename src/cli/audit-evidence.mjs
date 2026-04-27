import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "max-age-hours": { type: "string" },
  },
  allowPositionals: true,
});

const maxAgeHours = values["max-age-hours"] || "24";

console.log(`audit:evidence max-age-hours=${maxAgeHours}`);
console.log("Evidence freshness audit against receipt store (stub)");
console.log(JSON.stringify({ maxAgeHours, status: "stub_pass", note: "full audit pending PR 13 enablement" }));
