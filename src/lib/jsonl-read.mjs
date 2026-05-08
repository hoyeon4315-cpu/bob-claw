import { createReadStream } from "node:fs";
import { access, open } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

export async function readJsonl(baseDir, name) {
  const path = join(baseDir, `${name}.jsonl`);
  try {
    await access(path);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const records = [];
  const stream = createReadStream(path, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line) continue;
    records.push(JSON.parse(line));
  }
  return records;
}

export async function readLatestJsonlRecord(baseDir, name, { chunkSize = 64 * 1024 } = {}) {
  const path = join(baseDir, `${name}.jsonl`);
  let handle = null;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  try {
    const stats = await handle.stat();
    let position = stats.size;
    let text = "";
    while (position > 0) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const buffer = Buffer.alloc(readSize);
      await handle.read(buffer, 0, readSize, position);
      text = `${buffer.toString("utf8")}${text}`;
      const lines = text.split(/\r?\n/u).filter(Boolean);
      if (position > 0 && lines.length <= 1) continue;
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (position > 0 && index === 0) continue;
        return JSON.parse(lines[index]);
      }
    }
    return null;
  } finally {
    await handle.close();
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
