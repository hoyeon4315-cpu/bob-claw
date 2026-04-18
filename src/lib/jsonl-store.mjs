import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeJsonStringify } from "./json-safe.mjs";

export class JsonlStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  async append(name, record) {
    const path = join(this.baseDir, `${name}.jsonl`);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${safeJsonStringify(record)}\n`, "utf8");
    return path;
  }
}
