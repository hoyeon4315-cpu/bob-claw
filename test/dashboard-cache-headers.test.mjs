import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const HEADERS = readFileSync(join(process.cwd(), "dashboard", "public", "_headers"), "utf8");
const INDEX_HTML = readFileSync(join(process.cwd(), "dashboard", "public", "index.html"), "utf8");

test("dashboard disables browser cache for compiled javascript assets", () => {
  assert.match(HEADERS, /\/\*\.js\n\s+Cache-Control: no-cache, no-store, must-revalidate/);
});

test("dashboard script urls use the live refresh cache-buster", () => {
  // Cache-buster v-string is rotated on every dashboard refresh, so we
  // assert presence + non-empty value rather than a fixed literal (which
  // grows stale within hours of every public/index.html update).
  assert.match(INDEX_HTML, /data\.js\?v=[^"]+/);
  assert.match(INDEX_HTML, /app\.js\?v=[^"]+/);
});
