import { createReadStream } from "node:fs";
import { access, open } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

/**
 * @param {unknown} error
 * @returns {error is NodeJS.ErrnoException}
 */
function hasErrorCode(error) {
  return Boolean(error && typeof error === "object" && "code" in error);
}

/**
 * @param {string} baseDir
 * @param {string} name
 * @returns {Promise<unknown[]>}
 */
export async function readJsonl(baseDir, name) {
  const path = join(baseDir, `${name}.jsonl`);
  try {
    await access(path);
  } catch (error) {
    if (hasErrorCode(error) && error.code === "ENOENT") return [];
    throw error;
  }

  /** @type {unknown[]} */
  const records = [];
  const stream = createReadStream(path, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line) continue;
    records.push(JSON.parse(line));
  }
  return records;
}

/**
 * @param {string} baseDir
 * @param {string} name
 * @param {{ chunkSize?: number }} [options]
 * @returns {Promise<unknown | null>}
 */
export async function readLatestJsonlRecord(baseDir, name, { chunkSize = 64 * 1024 } = {}) {
  const path = join(baseDir, `${name}.jsonl`);
  let handle = null;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (hasErrorCode(error) && error.code === "ENOENT") return null;
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

/**
 * @template {{ observedAt: string | number | Date }} T
 * @param {T[]} items
 * @param {(item: T) => string} keyFn
 * @param {(item: T) => string | number | Date} [dateFn]
 */
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
