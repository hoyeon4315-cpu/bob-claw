import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const RADAR_DIR = new URL("../src/strategy/radar/", import.meta.url);

async function listMjsFiles(dirUrl) {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const childUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dirUrl);
    if (entry.isDirectory()) return listMjsFiles(childUrl);
    return entry.name.endsWith(".mjs") ? [childUrl] : [];
  }));
  return nested.flat();
}

test("radar modules do not import signer or mutable runtime config paths", async () => {
  const files = await listMjsFiles(RADAR_DIR);
  assert.ok(files.length > 0, "expected radar modules to exist");

  const forbidden = [
    /from\s+["'][^"']*executor\/signer/i,
    /from\s+["'][^"']*config\/strategy-caps\.mjs/i,
    /from\s+["'][^"']*config\/payback\.mjs/i,
    /from\s+["'][^"']*executor\/policy\/kill-switch\.mjs/i,
  ];

  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        violations.push(`${join(file.pathname)}:${pattern}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
