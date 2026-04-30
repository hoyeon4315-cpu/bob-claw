import { mkdir, readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

export function radarDir(dataDir) {
  return join(dataDir, "radar");
}

export function radarJsonlPath(dataDir, name) {
  return join(radarDir(dataDir), `${name}.jsonl`);
}

export async function appendRadarJsonl(dataDir, name, record) {
  await mkdir(radarDir(dataDir), { recursive: true });
  await appendFile(radarJsonlPath(dataDir, name), `${JSON.stringify(record)}\n`);
}

export async function readRadarJsonl(dataDir, name) {
  try {
    const raw = await readFile(radarJsonlPath(dataDir, name), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
