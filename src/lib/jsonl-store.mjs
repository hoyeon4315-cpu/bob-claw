import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class JsonlStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  async append(name, record) {
    const path = join(this.baseDir, `${name}.jsonl`);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
    return path;
  }
}

