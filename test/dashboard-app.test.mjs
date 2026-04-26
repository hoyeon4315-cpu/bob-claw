import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(
  join(HERE, "..", "dashboard", "public", "index.html"),
  "utf8"
);

function extractSection(startMarker, endMarker) {
  const start = INDEX_HTML.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = endMarker ? INDEX_HTML.indexOf(endMarker, start) : INDEX_HTML.length;
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return INDEX_HTML.slice(start, end);
}

describe("dashboard home renewal source guard", () => {
  test("flow home keeps five KPI metrics in one horizontal strip", () => {
    const metricStrip = extractSection("function FlowMetricGrid", "function RouteNode");
    assert.match(metricStrip, /display:\s*'flex'/);
    assert.match(metricStrip, /cards\.map/);

    const flowPane = extractSection("function FlowPane", "function KpiCard");
    const labels = ["Assets", "APR", "Paid back", "Carry", "Yield"];
    for (const label of labels) {
      assert.match(flowPane, new RegExp(`label:\\s*'${label.replace(" ", "\\s+")}'`));
    }
    assert.match(flowPane, /const yieldMain = grossYieldSats > 0/);
    assert.match(flowPane, /fmtUsdCompact\(grossYieldUsd\)\} · all protocols/);
  });

  test("history card defaults to 3 rows with expand/collapse and scroll guard", () => {
    const historySection = extractSection("function RouteNode", "function FlowPane");
    assert.match(historySection, /ChainLogo id=\{id\} size=\{16\}/);
    assert.match(historySection, /ProtocolLogo id=\{id\} size=\{16\}/);
    assert.match(historySection, /<RouteNode kind=\{route\.source\.kind\}/);
    assert.match(historySection, /<RouteNode kind=\{route\.target\.kind\}/);
    assert.match(historySection, /deriveActivityFinalAsset/);
    assert.match(historySection, /AssetLogo id=\{finalAsset\.id\} size=\{11\}/);
    assert.doesNotMatch(historySection, /Arrived/);

    const opsStrip = extractSection("function OpsStrip", "function FlowPane");
    assert.match(opsStrip, /History/);
    assert.match(opsStrip, /activities\.slice\(0,\s*3\)/);
    assert.match(opsStrip, /expanded \? 'Show less' : `Show more · \$\{activities\.length\}`/);
    assert.match(opsStrip, /overflowY:\s*'auto'/);
    assert.match(opsStrip, /overscrollBehavior:\s*'contain'/);
    assert.match(opsStrip, /display: 'flex', flexDirection: 'column'/);
  });
});

describe("dashboard defi renewal source guard", () => {
  test("defi rows stay compact and English-first", () => {
    const strategyKind = extractSection("function strategyKind", "function strategyMechanics");
    for (const label of ["Loop", "Fold", "PT", "CL LP", "LP", "Basis", "Bridge", "Payback", "Arb", "Swap", "Canary", "Reserve", "Refuel"]) {
      assert.match(strategyKind, new RegExp(`return '${label.replace(" ", "\\s+")}'`));
    }
    assert.doesNotMatch(strategyKind, /[가-힣]/);

    const defiPane = extractSection("function DefiPane", "function pairTokens");
    assert.match(defiPane, /No live strategies/);
    assert.match(defiPane, /live position/);
    assert.match(defiPane, /Cap \$/);
    assert.match(defiPane, /fmtYieldTag/);
    assert.match(defiPane, /fmtYieldSubLabel/);

    const strategyRow = extractSection("function StrategyRow", "function AssetsPane");
    assert.match(strategyRow, /APR/);
    assert.match(strategyRow, /fmtYieldTag\(s\.earnedUsd, s\.yieldBasis\)/);
    assert.doesNotMatch(strategyRow, /[가-힣]/);
    assert.doesNotMatch(strategyRow, /badge/i);
  });

  test("flow pane expands the map above lower cards during focus mode", () => {
    const flowPane = extractSection("function FlowPane", "function KpiCard");
    assert.match(flowPane, /const \[mindmapFocus, setMindmapFocus\] = useState\(\{ layer: 'root' \}\)/);
    assert.match(flowPane, /overlayActive \? 'calc\(100% - 12px\)' : 'calc\(56% - 4px\)'/);
    assert.match(flowPane, /<Mindmap motionSpeed=\{1\.4\} refreshTick=\{refreshTick\} onFocusChange=\{setMindmapFocus\}/);
    assert.match(flowPane, /position: 'absolute'/);
    assert.match(flowPane, /top: 'calc\(56% \+ 4px\)'/);
    assert.match(flowPane, /bottom: 0/);
    assert.match(flowPane, /pointerEvents: overlayActive \? 'none' : 'auto'/);
    assert.match(flowPane, /<OpsStrip fill=\{true\}\/>/);
  });
});
