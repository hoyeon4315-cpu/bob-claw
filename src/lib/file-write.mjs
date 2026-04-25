import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  await writeFile(path, contents, "utf8");
  return {
    path,
    changed: true,
  };
}
