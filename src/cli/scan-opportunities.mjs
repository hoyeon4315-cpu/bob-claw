import { parseArgs } from "node:util";

const { values } = parseArgs({ allowPositionals: true });

console.log("scan:opportunities — Merkl + DefiLlama scan (stub)");
console.log(JSON.stringify({ status: "stub", opportunities: [], note: "enable in PR 13" }));
