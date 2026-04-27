import { parseArgs } from "node:util";

const { values } = parseArgs({ allowPositionals: true });

console.log("audit:concentration — chain/protocol/opportunity concentration audit (stub)");
console.log(JSON.stringify({ status: "stub", allocations: {}, note: "enable in PR 13" }));
