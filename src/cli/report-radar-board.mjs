#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { readRadarJsonl } from "../strategy/radar/jsonl.mjs";
import { buildRadarBoard } from "../strategy/radar/radar-board.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const [rawKey, inlineValue] = item.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args[rawKey] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[rawKey] = true;
      continue;
    }
    args[rawKey] = next;
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const dataDir = resolve(args["data-dir"] || "data");
  const observations = await readRadarJsonl(dataDir, "opportunity-observations");
  const episodes = await readRadarJsonl(dataDir, "strategy-episodes");
  const packets = await readRadarJsonl(dataDir, "portable-packets");
  const candidates = await readRadarJsonl(dataDir, "executable-candidates");
  const realizationRecords = await readRadarJsonl(dataDir, "realization-records");
  const board = buildRadarBoard({ observations, episodes, packets, candidates, realizationRecords });
  if (args.write) {
    const outputPath = args.write === true
      ? resolve(join(dataDir, "radar-board.json"))
      : resolve(args.write);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(board, null, 2)}\n`);
    if (args.json) {
      console.log(JSON.stringify(board, null, 2));
    } else {
      console.log(`wrote=${outputPath}`);
    }
  } else {
    console.log(JSON.stringify(board, null, 2));
  }
  if (!args.json) {
    console.log(`observed=${board.summary.observedCount}`);
    console.log(`candidates=${board.summary.candidateCount}`);
    console.log(`executable=${board.summary.executableCount}`);
    console.log(`blocked=${board.summary.blockedCandidateCount}`);
    console.log(`topBlocker=${board.summary.topCandidateBlocker || "n/a"}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
