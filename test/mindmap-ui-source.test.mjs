import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MINDMAP_JSX = readFileSync(
  join(HERE, "..", "dashboard", "public", "mindmap.jsx"),
  "utf8"
);

describe("mindmap source guard", () => {
  test("background click steps back one layer instead of resetting everything", () => {
    assert.match(MINDMAP_JSX, /const stepBack = \(\) => \{/);
    assert.match(MINDMAP_JSX, /if \(selectedProtocolId\) \{/);
    assert.match(MINDMAP_JSX, /if \(selectedChain\) \{/);
    assert.match(MINDMAP_JSX, /<svg ref=\{svgRef\} width="100%" height="100%" viewBox=\{`0 0 \$\{VB_W\} \$\{VB_H\}`\} preserveAspectRatio="xMidYMid meet" onClick=\{stepBack\}>/);
    assert.doesNotMatch(MINDMAP_JSX, /const resetAll = \(\) => \{ setSelectedChain\(null\); setSelectedProtocolId\(null\); \};/);
  });

  test("mindmap focuses protocols with capital and dims siblings on protocol zoom", () => {
    assert.match(MINDMAP_JSX, /if \(!strategy\.protocol\) return false;/);
    assert.match(MINDMAP_JSX, /return Number\(strategy\.actualProtocolCapitalUsd \|\| 0\) > 0;/);
    assert.match(MINDMAP_JSX, /const dimmed = Boolean\(selectedProtocolId\) && !isSel;/);
    assert.match(MINDMAP_JSX, /opacity: dimmed \? 0\.22 : 1/);
  });

  test("chain and protocol nodes render compact USD pills", () => {
    assert.match(MINDMAP_JSX, /function StatPill\(/);
    assert.match(MINDMAP_JSX, /function formatYieldDisplay\(/);
    assert.match(MINDMAP_JSX, /const capitalLabel = formatCompactUsdLabel\(chain\.capitalUsd\)/);
    assert.match(MINDMAP_JSX, /const capitalLabel = formatCompactUsdLabel\(strategy\.capitalUsd\)/);
    assert.match(MINDMAP_JSX, /const capitalY = labelBelow \? size \* 1\.46 : -size \* 1\.34;/);
    assert.match(MINDMAP_JSX, /includeRect\(bounds, point\.x, point\.y - chipRadius - 17, 58, 16\)/);
    assert.match(MINDMAP_JSX, /yieldMetricLabel\(protocolNode\.yieldBasis\)/);
  });
});
