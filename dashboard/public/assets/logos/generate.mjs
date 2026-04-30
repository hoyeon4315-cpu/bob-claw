// Reproducible generator for the dashboard placeholder SVG set:
//   BOB Gateway destination chains + protocols touched by adapters/live positions.
//
// Why letter-mark placeholders instead of brand-supplied artwork?
//   - We do NOT have signed brand-usage approval for every protocol/chain in
//     scope. Shipping their official trademarked logos as-is would be an
//     unverified copyright/trademark exposure on a public dashboard.
//   - A neutral letter-mark in the brand's primary color preserves the visual
//     identity that lets a mobile user distinguish chains/protocols at a glance
//     while staying inside fair-use safe ground until each brand's mark is
//     replaced with the official artwork under its declared license.
//   - The replacement contract is documented per-asset in LICENSES.md. Each
//     real artwork swap is a one-file diff that this generator does not need
//     to know about.
//
// Inputs (chain/protocol id, brand primary color, mark text) live in this file
// so the diff that swaps a real SVG also documents what it replaced.
//
//   $ node dashboard/public/assets/logos/generate.mjs

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const CHAIN_MARKS = Object.freeze([
  { id: "bitcoin",   color: "#F7931A", mark: "₿",   ink: "#FFFFFF" },
  { id: "bob",       color: "#F25D2B", mark: "BOB", ink: "#FFFFFF" },
  { id: "ethereum",  color: "#627EEA", mark: "Ξ",   ink: "#FFFFFF" },
  { id: "base",      color: "#0052FF", mark: "B",   ink: "#FFFFFF" },
  { id: "bsc",       color: "#F0B90B", mark: "BNB", ink: "#181A20" },
  { id: "avalanche", color: "#E84142", mark: "AVA", ink: "#FFFFFF" },
  { id: "unichain",  color: "#FF007A", mark: "U",   ink: "#FFFFFF" },
  { id: "bera",      color: "#814625", mark: "BERA",ink: "#FFFFFF" },
  { id: "optimism",  color: "#FF0420", mark: "OP",  ink: "#FFFFFF" },
  { id: "soneium",   color: "#000000", mark: "SO",  ink: "#FFFFFF" },
  { id: "sei",       color: "#9D1F19", mark: "SEI", ink: "#FFFFFF" },
  { id: "sonic",     color: "#FE9A4D", mark: "S",   ink: "#FFFFFF" },
]);

export const PROTOCOL_MARKS = Object.freeze([
  { id: "moonwell",   color: "#00D395", mark: "MW", ink: "#0B1F18" },
  { id: "morpho",     color: "#2D4A7C", mark: "Mo", ink: "#FFFFFF" },
  { id: "aave",       color: "#B6509E", mark: "AA", ink: "#FFFFFF" },
  { id: "euler",      color: "#2AE5B9", mark: "EU", ink: "#0B1F18" },
  { id: "yo",         color: "#CCFF00", mark: "YO", ink: "#111113" },
  { id: "pendle",     color: "#00ADAB", mark: "PT", ink: "#FFFFFF" },
  { id: "aerodrome",  color: "#1656F7", mark: "AE", ink: "#FFFFFF" },
  { id: "beefy",      color: "#4DB258", mark: "BF", ink: "#FFFFFF" },
  { id: "gmx",        color: "#2D52F5", mark: "GM", ink: "#FFFFFF" },
  { id: "bend",       color: "#ED9D08", mark: "BD", ink: "#1A1109" },
  { id: "bex",        color: "#814625", mark: "BX", ink: "#FFFFFF" },
  { id: "k3capital",  color: "#6B3FA0", mark: "K3", ink: "#FFFFFF" },
  { id: "babylon",    color: "#CE6533", mark: "BA", ink: "#FFFFFF" },
  { id: "solv",       color: "#1B1B1B", mark: "SO", ink: "#FFFFFF" },
  { id: "gateway",    color: "#F25D2B", mark: "GW", ink: "#FFFFFF" },
  { id: "odos",       color: "#1F2937", mark: "OD", ink: "#FFFFFF" },
  { id: "gaszip",     color: "#10B981", mark: "GZ", ink: "#0B1F18" },
]);

export const OFFICIAL_LOCAL_PROTOCOL_IDS = Object.freeze(new Set([
  "yo",
]));

export function renderLetterMark({ id, color, mark, ink }) {
  const chars = String(mark || "?");
  const fontSize =
    chars.length === 1 ? 38 :
    chars.length === 2 ? 28 :
    chars.length === 3 ? 22 : 18;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="${id}">
  <title>${id}</title>
  <circle cx="32" cy="32" r="32" fill="${color}"/>
  <text x="32" y="32" text-anchor="middle" dominant-baseline="central"
        font-family="-apple-system, SF Pro Text, Helvetica Neue, Arial, sans-serif"
        font-weight="700" font-size="${fontSize}" fill="${ink}"
        letter-spacing="-0.5">${chars}</text>
</svg>
`;
}

export function buildManifest({ chains = CHAIN_MARKS, protocols = PROTOCOL_MARKS } = {}) {
  return {
    schema: "bobclaw-logo-manifest@1",
    chains: chains.map((c) => ({ id: c.id, file: `chains/${c.id}.svg`, color: c.color })),
    protocols: protocols.map((p) => ({ id: p.id, file: `protocols/${p.id}.svg`, color: p.color })),
  };
}

function main() {
  mkdirSync(join(HERE, "chains"), { recursive: true });
  mkdirSync(join(HERE, "protocols"), { recursive: true });
  for (const c of CHAIN_MARKS) {
    writeFileSync(join(HERE, "chains", `${c.id}.svg`), renderLetterMark(c));
  }
  for (const p of PROTOCOL_MARKS) {
    const outputPath = join(HERE, "protocols", `${p.id}.svg`);
    if (OFFICIAL_LOCAL_PROTOCOL_IDS.has(p.id) && existsSync(outputPath)) continue;
    writeFileSync(outputPath, renderLetterMark(p));
  }
  writeFileSync(
    join(HERE, "manifest.json"),
    JSON.stringify(buildManifest(), null, 2) + "\n"
  );
  console.log(`wrote ${CHAIN_MARKS.length} chain + ${PROTOCOL_MARKS.length} protocol SVGs + manifest.json`);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
