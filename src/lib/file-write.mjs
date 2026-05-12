import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * @param {unknown} error
 * @returns {error is NodeJS.ErrnoException}
 */
function hasErrorCode(error) {
  return Boolean(error && typeof error === "object" && "code" in error);
}

/**
 * @param {string} path
 * @param {string} contents
 * @param {{ normalize?: (value: string | null) => string | null }} [options]
 */
export async function writeTextIfChanged(path, contents, options = {}) {
  const normalize = options.normalize || ((value) => value);
  let previous = null;
  try {
    previous = await readFile(path, "utf8");
  } catch (error) {
    if (!hasErrorCode(error) || error.code !== "ENOENT") throw error;
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
