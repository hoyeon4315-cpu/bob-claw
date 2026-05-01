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

  test("mindmap focuses protocols with capital or recent activity and dims siblings on protocol zoom", () => {
    assert.match(MINDMAP_JSX, /if \(!strategy\.protocol\) return false;/);
    assert.match(MINDMAP_JSX, /return strategy\.status === 'LIVE'/);
    assert.match(MINDMAP_JSX, /strategy\.activeStrategyState === 'live_position'/);
    assert.match(MINDMAP_JSX, /return Number\(strategy\.actualProtocolCapitalUsd \|\| 0\) > 0/);
    assert.match(MINDMAP_JSX, /function hasRecentMindmapActivity\(strategy\)/);
    assert.match(MINDMAP_JSX, /return hasRecentMindmapActivity\(strategy\)/);
    assert.match(MINDMAP_JSX, /strategy\.surfaceOnly === 'mindmap'/);
    assert.match(MINDMAP_JSX, /const focusPoint = selectedProtocolId \? \(protocolBloom\[selectedProtocolId\] \|\| null\) : null;/);
    assert.match(MINDMAP_JSX, /const focus = focusPoint/);
    assert.match(MINDMAP_JSX, /function ProtocolAssetMotion\(/);
    assert.match(MINDMAP_JSX, /function uniqueProtocolAssets\(/);
    assert.match(MINDMAP_JSX, /{isSel && \(/);
    assert.match(MINDMAP_JSX, /<ProtocolAssetMotion/);
    assert.match(MINDMAP_JSX, /const dimmed = Boolean\(selectedProtocolId\) && !isSel;/);
    assert.match(MINDMAP_JSX, /const chainDimmed = Boolean\(selectedProtocolId\) && active;/);
    assert.match(MINDMAP_JSX, /opacity: dimmed \? 0\.22 : 1/);
  });

  test("mindmap lane highlighting uses live positions, not historical activity", () => {
    assert.match(MINDMAP_JSX, /function isMindmapActiveStrategy\(strategy\)/);
    assert.match(MINDMAP_JSX, /\.filter\(\(strategy\) => isMindmapActiveStrategy\(strategy\)\)/);
    assert.doesNotMatch(MINDMAP_JSX, /\.filter\(\(strategy\) => strategy\.status === 'LIVE' \|\| Number\(strategy\.recentActivityCount \|\| 0\) > 0\)/);
  });

  test("chain and protocol nodes render compact USD pills and bounded protocol cards", () => {
    assert.match(MINDMAP_JSX, /function StatPill\(/);
    assert.match(MINDMAP_JSX, /function formatYieldDisplay\(/);
    assert.match(MINDMAP_JSX, /function weightedProtocolApy\(strategies = \[\]\)/);
    assert.match(MINDMAP_JSX, /function apyWeightUsd\(strategy\)/);
    assert.match(MINDMAP_JSX, /const weightedRows = rows\.filter\(\(strategy\) => apyWeightUsd\(strategy\) > 0\)/);
    assert.match(MINDMAP_JSX, /return rows\.reduce\(\(sum, strategy\) => sum \+ strategy\.apyPct, 0\) \/ rows\.length/);
    assert.match(MINDMAP_JSX, /apyPct: weightedProtocolApy\(items\)/);
    assert.match(MINDMAP_JSX, /const PROTOCOL_CARD_MAX_HEIGHT = 132;/);
    assert.match(MINDMAP_JSX, /const PROTOCOL_CARD_SAFE_BOTTOM = 188;/);
    assert.match(MINDMAP_JSX, /const PROTOCOL_CHIP_SIZE = 30;/);
    assert.match(MINDMAP_JSX, /const PROTOCOL_BLOOM_MIN_RADIUS = 112;/);
    assert.match(MINDMAP_JSX, /const PROTOCOL_BLOOM_PADDING = 22;/);
    assert.match(MINDMAP_JSX, /\.\.\.items\.map\(\(item\) => Number\(item\.actualProtocolCapitalUsd \|\| 0\)\)/);
    assert.match(MINDMAP_JSX, /const capitalLabel = formatCompactUsdLabel\(Number\(strategy\.capitalUsd \|\| 0\)\)/);
    assert.match(MINDMAP_JSX, /const capitalLabel = formatCompactUsdLabel\(Number\(window\.CAPITAL\?\.byChain\?\.\[chainId\] \|\| 0\)\)/);
    assert.match(MINDMAP_JSX, /const capitalY = labelBelow \? size \* 1\.46 : -size \* 1\.34;/);
    assert.match(MINDMAP_JSX, /includeRect\(bounds, point\.x, point\.y - chipRadius - 19, 62, 16\)/);
    assert.match(MINDMAP_JSX, /includeRect\(bounds, point\.x, point\.y - chipSize \* 2\.48, 48, 18\)/);
    assert.match(MINDMAP_JSX, /yieldMetricLabel\(protocolNode\.yieldBasis\)/);
    assert.match(MINDMAP_JSX, /maxHeight: PROTOCOL_CARD_MAX_HEIGHT/);
    assert.match(MINDMAP_JSX, /const protocolAssets = Array\.from\(new Set\(\[/);
    assert.match(MINDMAP_JSX, /protocolNode\.recentActivityAssets/);
    assert.doesNotMatch(MINDMAP_JSX, /const visibleStrategies = protocolNode\.strategies\.slice\(0, PROTOCOL_CARD_STRATEGY_PREVIEW_COUNT\);/);
    assert.doesNotMatch(MINDMAP_JSX, />Pair<\/span>/);
    assert.doesNotMatch(MINDMAP_JSX, /<Metric label="Mapped"/);
    assert.doesNotMatch(MINDMAP_JSX, /\+\{hiddenStrategyCount\} more/);
  });

  test("selected protocol view keeps asset motion logo-only without duplicate pair text", () => {
    assert.match(MINDMAP_JSX, /function AssetLogoTag\(/);
    assert.doesNotMatch(MINDMAP_JSX, /function AssetTickerPill\(/);
    assert.doesNotMatch(MINDMAP_JSX, /join\(' \/ '\)/);
    assert.doesNotMatch(MINDMAP_JSX, /strategy\.strategies\?\.\[0\]\?\.label \|\| strategy\.label \|\| strategy\.protocol/);
  });

  test("focus mode dampens motion on zoomed protocol views", () => {
    assert.match(MINDMAP_JSX, /const focusMotionScale = selectedProtocolId \? 0\.16 : selectedChain \? 0\.34 : 1;/);
    assert.match(MINDMAP_JSX, /const settlePull = selectedProtocolId \? 0\.18 : selectedChain \? 0\.08 : 0;/);
    assert.match(MINDMAP_JSX, /b\.x \+= \(b\.anchorX - b\.x\) \* settlePull;/);
  });
});
