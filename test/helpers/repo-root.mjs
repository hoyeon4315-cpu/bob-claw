import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function repoPath(...segments) {
  return resolve(REPO_ROOT, ...segments);
}
