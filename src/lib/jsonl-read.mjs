import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function readJsonl(baseDir, name) {
  const path = join(baseDir, `${name}.jsonl`);
  try {
    const text = await readFile(path, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export function latestBy(items, keyFn, dateFn = (item) => item.observedAt) {
  const latest = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const existing = latest.get(key);
    if (!existing || new Date(dateFn(item)) > new Date(dateFn(existing))) {
      latest.set(key, item);
    }
  }
  return latest;
}

