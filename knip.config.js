import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL(".", import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const PACKAGE_JSON = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

function collectCommandEntries(command) {
  return [
    ...command.matchAll(/(?:node|bash)\s+([^\s&|;]+(?:\.(?:cjs|js|mjs|sh)))/g),
  ].map(([, file]) => file);
}

function walkFiles(dirPath, predicate, files = []) {
  for (const entry of readdirSync(dirPath)) {
    const absolutePath = join(dirPath, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      walkFiles(absolutePath, predicate, files);
      continue;
    }
    if (predicate(absolutePath)) files.push(absolutePath);
  }
  return files;
}

function collectPathReferencedEntries() {
  const searchRoots = ["src", "test", "scripts", ".github/workflows"];
  const literalPathPattern =
    /["'`](src\/cli\/[^"'`\s]+\.(?:mjs|sh)|scripts\/[^"'`\s]+\.(?:mjs|sh)|research\/[^"'`\s]+\.mjs)["'`]/g;
  const entries = new Set();

  for (const root of searchRoots) {
    for (const absolutePath of walkFiles(join(ROOT_PATH, root), (filePath) =>
      /\.(?:mjs|cjs|js|yml|yaml)$/.test(filePath),
    )) {
      const source = readFileSync(absolutePath, "utf8");
      for (const match of source.matchAll(literalPathPattern))
        entries.add(match[1]);
    }
  }

  return [...entries];
}

const scriptEntries = Object.values(PACKAGE_JSON.scripts ?? {}).flatMap(
  collectCommandEntries,
);
const referencedEntries = collectPathReferencedEntries();

const operatorEntryFiles = [
  // Operator-run CLIs that are canonical in AGENTS/docs but may be invoked outside package.json.
  "dashboard/public/app.jsx",
  "dashboard/public/data.jsx",
  "dashboard/public/ios-frame.jsx",
  "dashboard/public/logos.jsx",
  "dashboard/public/mindmap.jsx",
  "research/candidates/**/*.mjs",
  "research/trackA-agent.mjs",
  "src/cli/executor-money-loop.mjs",
  "src/cli/run-strategy-tick.mjs",
];

const entry = [
  ...new Set([
    ...scriptEntries,
    ...referencedEntries,
    ...operatorEntryFiles,
    "test/**/*.test.mjs",
  ]),
].sort();

export default {
  // Fail fast when Knip thinks config is incomplete instead of papering over false positives.
  treatConfigHintsAsErrors: true,
  entry,
  project: [
    "src/cli/**/*.{mjs,sh}",
    "research/**/*.{js,mjs,cjs}",
    "dashboard/public/**/*.jsx",
  ],
  ignoreFiles: [
    // Generated dashboard bundles and local preview trees are operational artifacts, not source inputs.
    ".claude/**",
    "dashboard/public.legacy/**",
    "dashboard/public/*.js",
    "deploy-verify.cjs",
    "knip.config.js",
    "preview/**",
  ],
};
