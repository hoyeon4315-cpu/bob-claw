import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAIN_MARKS,
  PROTOCOL_MARKS,
  renderLetterMark,
  buildManifest,
} from "../dashboard/public/assets/logos/generate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGOS_DIR = join(HERE, "..", "dashboard", "public", "assets", "logos");

const REQUIRED_CHAINS = [
  "bitcoin", "ethereum", "base", "bsc", "avalanche", "unichain",
  "bera", "optimism", "soneium", "sei", "sonic",
];
const REQUIRED_PROTOCOLS = [
  "moonwell", "morpho", "pendle", "aerodrome", "beefy", "gmx",
  "bend", "bex", "k3capital", "babylon", "solv",
];

describe("T25 logo asset coverage", () => {
  test("11 chain marks declared, all required ids covered", () => {
    assert.equal(CHAIN_MARKS.length, 11);
    const ids = new Set(CHAIN_MARKS.map((c) => c.id));
    for (const id of REQUIRED_CHAINS) {
      assert.ok(ids.has(id), `missing chain mark: ${id}`);
    }
  });

  test("11 protocol marks declared, all required ids covered", () => {
    assert.equal(PROTOCOL_MARKS.length, 11);
    const ids = new Set(PROTOCOL_MARKS.map((p) => p.id));
    for (const id of REQUIRED_PROTOCOLS) {
      assert.ok(ids.has(id), `missing protocol mark: ${id}`);
    }
  });

  test("every chain SVG file exists on disk", () => {
    for (const c of CHAIN_MARKS) {
      const path = join(LOGOS_DIR, "chains", `${c.id}.svg`);
      assert.ok(existsSync(path), `missing file: ${path}`);
    }
  });

  test("every protocol SVG file exists on disk", () => {
    for (const p of PROTOCOL_MARKS) {
      const path = join(LOGOS_DIR, "protocols", `${p.id}.svg`);
      assert.ok(existsSync(path), `missing file: ${path}`);
    }
  });
});

describe("T25 SVG content invariants", () => {
  test("chain SVGs declare role=img, aria-label, viewBox, brand color", () => {
    for (const c of CHAIN_MARKS) {
      const path = join(LOGOS_DIR, "chains", `${c.id}.svg`);
      const svg = readFileSync(path, "utf8");
      assert.match(svg, /role="img"/, `${c.id}: missing role`);
      assert.match(svg, new RegExp(`aria-label="${c.id}"`), `${c.id}: missing aria-label`);
      assert.match(svg, /viewBox="0 0 64 64"/, `${c.id}: viewBox drift`);
      assert.ok(svg.includes(c.color), `${c.id}: brand color ${c.color} not in svg`);
    }
  });

  test("protocol SVGs declare role=img, aria-label, viewBox, brand color", () => {
    for (const p of PROTOCOL_MARKS) {
      const path = join(LOGOS_DIR, "protocols", `${p.id}.svg`);
      const svg = readFileSync(path, "utf8");
      assert.match(svg, /role="img"/, `${p.id}: missing role`);
      assert.match(svg, new RegExp(`aria-label="${p.id}"`), `${p.id}: missing aria-label`);
      assert.match(svg, /viewBox="0 0 64 64"/, `${p.id}: viewBox drift`);
      assert.ok(svg.includes(p.color), `${p.id}: brand color ${p.color} not in svg`);
    }
  });

  test("renderLetterMark is deterministic", () => {
    const c = CHAIN_MARKS[0];
    assert.equal(renderLetterMark(c), renderLetterMark(c));
  });

  test("renderLetterMark scales font with mark length", () => {
    const one = renderLetterMark({ id: "x", color: "#000", mark: "A", ink: "#fff" });
    const two = renderLetterMark({ id: "x", color: "#000", mark: "AB", ink: "#fff" });
    const three = renderLetterMark({ id: "x", color: "#000", mark: "ABC", ink: "#fff" });
    assert.match(one, /font-size="38"/);
    assert.match(two, /font-size="28"/);
    assert.match(three, /font-size="22"/);
  });
});

describe("T25 manifest + license", () => {
  test("manifest.json present, schema versioned, lists all 22 entries", () => {
    const path = join(LOGOS_DIR, "manifest.json");
    assert.ok(existsSync(path), "manifest.json missing");
    const m = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(m.schema, "bobclaw-logo-manifest@1");
    assert.equal(m.chains.length, 11);
    assert.equal(m.protocols.length, 11);
  });

  test("buildManifest matches generator output", () => {
    const m = buildManifest();
    assert.equal(m.chains.length, 11);
    assert.equal(m.protocols.length, 11);
    for (const c of m.chains) assert.match(c.file, /^chains\/[a-z0-9]+\.svg$/);
    for (const p of m.protocols) assert.match(p.file, /^protocols\/[a-z0-9]+\.svg$/);
  });

  test("LICENSES.md present and references every id", () => {
    const path = join(LOGOS_DIR, "LICENSES.md");
    assert.ok(existsSync(path), "LICENSES.md missing");
    const md = readFileSync(path, "utf8");
    for (const c of CHAIN_MARKS) {
      assert.ok(md.includes(`chains/${c.id}.svg`), `LICENSES.md missing chain row: ${c.id}`);
    }
    for (const p of PROTOCOL_MARKS) {
      assert.ok(md.includes(`protocols/${p.id}.svg`), `LICENSES.md missing protocol row: ${p.id}`);
    }
  });
});
