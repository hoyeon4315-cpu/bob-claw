import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeTextIfChanged(path, contents, options = {}) {
  const normalize = options.normalize || ((value) => value);
  let previous = null;
  try {
    previous = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (normalize(previous) === normalize(contents)) {
    return {
      path,
      changed: false,
    };
  }

  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmpPath, contents, "utf8");
    await rename(tmpPath, path);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
  return {
    path,
    changed: true,
  };
}
