import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_SOURCE = readFileSync(
  join(HERE, "..", "dashboard", "public", "app.jsx"),
  "utf8"
);
const DATA_SOURCE = readFileSync(
  join(HERE, "..", "dashboard", "public", "data.jsx"),
  "utf8"
);
const INDEX_HTML = readFileSync(
  join(HERE, "..", "dashboard", "public", "index.html"),
  "utf8"
);

function extractSection(startMarker, endMarker, source = APP_SOURCE) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start) : source.length;
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

describe("dashboard home renewal source guard", () => {
  test("dashboard shell loads prebuilt public scripts without browser Babel", () => {
    assert.doesNotMatch(INDEX_HTML, /text\/babel/);
    assert.doesNotMatch(INDEX_HTML, /@babel\/standalone/);
    for (const asset of ["./logos.js", "./data.js", "./ios-frame.js", "./mindmap.js", "./app.js"]) {
      assert.match(INDEX_HTML, new RegExp(asset.replace(".", "\\.")));
    }
  });

  test("flow home keeps five KPI metrics in one horizontal strip", () => {
    const metricStrip = extractSection("function FlowMetricGrid", "function RouteNode");
    assert.match(metricStrip, /display:\s*'flex'/);
    assert.match(metricStrip, /cards\.map/);

    const flowPane = extractSection("function FlowPane", "function KpiCard");
    const labels = ["Assets", "APR", "Paid back", "Carry", "Yield"];
    for (const label of labels) {
      assert.match(flowPane, new RegExp(`label:\\s*'${label.replace(" ", "\\s+")}'`));
    }
    assert.match(flowPane, /const strategyYieldUsd = STRATEGIES\.reduce/);
    assert.match(flowPane, /const showPortfolioYield = strategyYieldUsd > 0 && \(grossYieldSats <= 0 \|\| grossYieldSats === carrySats\)/);
    assert.match(flowPane, /'live est\. · all protocols'/);
    assert.match(flowPane, /wallet only · 0 open positions/);
    assert.match(flowPane, /wallet \+ \$\{positions\.length\} open position/);
    assert.doesNotMatch(flowPane, /<PnlBreakdownStrip\/>/);
  });

  test("flow home surfaces realized strategy vs probe cost split", () => {
    const pnlStrip = extractSection("function PnlBreakdownStrip", "function FlowPane");
    assert.match(pnlStrip, /Realized split/);
    assert.match(pnlStrip, /strategy vs transport \/ probe cost/);
    assert.match(pnlStrip, /<TriCard compact cells=\{\[/);
    assert.match(pnlStrip, /label: 'Strategy'/);
    assert.match(pnlStrip, /label: 'Probe cost'/);
    assert.match(pnlStrip, /label: 'Total'/);
    assert.match(pnlStrip, /Top drags:/);
    assert.match(pnlStrip, /pnlKindLabel/);
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

    const utilitySection = extractSection("function formatStatusAge", "function normalizeUiStrategyId");
    assert.match(utilitySection, /const HISTORY_FILTER_STORAGE_KEY = 'bob-claw:history-filter'/);
    assert.match(utilitySection, /function readPersistedHistoryFilter\(\)/);
    assert.match(utilitySection, /window\.localStorage\.getItem\(HISTORY_FILTER_STORAGE_KEY\)/);
    assert.match(utilitySection, /function writePersistedHistoryFilter\(value\)/);
    assert.match(utilitySection, /window\.localStorage\.setItem\(HISTORY_FILTER_STORAGE_KEY, value\)/);

    const opsStrip = extractSection("function OpsStrip", "function FlowPane");
    assert.match(opsStrip, /History/);
    assert.match(opsStrip, /function OpsStrip\(\{ fill = false, onExpandedChange = null \}\)/);
    assert.match(opsStrip, /const txActivities = activities\.filter\(\(activity\) => activity\?\.kind === 'transaction'\)/);
    assert.match(opsStrip, /const positionActivities = activities\.filter\(\(activity\) => activity\?\.kind === 'position'\)/);
    assert.match(opsStrip, /const paybackActivities = activities\.filter\(\(activity\) => activity\?\.kind === 'payback'\)/);
    assert.match(opsStrip, /const inFlightTxCount = txActivities\.filter\(\(activity\) => activity\?\.status === 'signed' \|\| activity\?\.status === 'broadcasted'\)\.length/);
    assert.match(opsStrip, /const confirmedTxCount = txActivities\.filter\(\(activity\) => activity\?\.status === 'confirmed'\)\.length/);
    assert.match(opsStrip, /const expandIntoFlow = fill && expanded/);
    assert.match(opsStrip, /const \[filter, setFilter\] = useState\(\(\) => readPersistedHistoryFilter\(\)\)/);
    assert.match(opsStrip, /const filteredActivities = activities\.filter\(\(activity\) => \{/);
    assert.match(opsStrip, /id: 'all', label: `All \$\{activities\.length\}`/);
    assert.match(opsStrip, /id: 'in_flight', label: `In flight \$\{inFlightTxCount\}`/);
    assert.match(opsStrip, /id: 'confirmed', label: `Confirmed \$\{confirmedTxCount\}`/);
    assert.match(opsStrip, /id: 'tx', label: `TX \$\{txActivities\.length\}`/);
    assert.match(opsStrip, /id: 'position', label: `Position \$\{positionActivities\.length\}`/);
    assert.match(opsStrip, /id: 'payback', label: `Payback \$\{paybackActivities\.length\}`/);
    assert.match(opsStrip, /setExpanded\(false\);/);
    assert.match(opsStrip, /setFilter\(chip\.id\);/);
    assert.match(opsStrip, /const allowed = new Set\(filterChips\.map\(\(item\) => item\.id\)\)/);
    assert.match(opsStrip, /if \(!allowed\.has\(filter\)\)/);
    assert.match(opsStrip, /writePersistedHistoryFilter\(filter\);/);
    assert.match(opsStrip, /if \(typeof onExpandedChange === 'function'\) onExpandedChange\(expanded\);/);
    assert.match(opsStrip, /filteredActivities\.slice\(0,\s*3\)/);
    assert.match(opsStrip, /expanded \? 'Show less' : `Show more · \$\{filteredActivities\.length\}`/);
    assert.match(opsStrip, /overflow:\s*expandIntoFlow \? 'visible' : 'hidden'/);
    assert.match(opsStrip, /overflowY:\s*fill && !expandIntoFlow \? 'auto' : 'visible'/);
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
    assert.match(defiPane, /<PnlBreakdownStrip inline\/>/);
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

  test("assets pane shows open position count alongside wallet and deployed balances", () => {
    const assetsPane = extractSection("function AssetsPane", "function App");
    assert.match(assetsPane, /open positions \{positions\.length\}/);
    assert.match(assetsPane, /wallet \{fmtUsd\(HOLDINGS\?\.walletUsd\)\} · deployed \{fmtUsd\(HOLDINGS\?\.deployedUsd\)\}/);
    assert.match(assetsPane, /whole-wallet live/);
    assert.match(assetsPane, /policy inventory/);
    assert.match(assetsPane, /wallet observed \$\{formatStatusAge\(HOLDINGS\.walletObservedAt\) \|\| fmtWhen\(HOLDINGS\.walletObservedAt\)\}/);
    assert.match(assetsPane, /scan errors \$\{HOLDINGS\.walletScanErrorCount\}/);
    assert.match(assetsPane, /scan clean/);
    assert.match(assetsPane, /external address scan inactive/);
    assert.match(assetsPane, /external address scan \$\{fmtUsd\(HOLDINGS\?\.externalWalletUsd\)\}/);
    assert.match(assetsPane, /unclassified \$\{fmtUsd\(HOLDINGS\.unclassifiedUsd\)\}/);
    assert.match(assetsPane, /const isExternalDelta = symBase === 'other' \|\| a\.family === 'external_unclassified'/);
    assert.match(assetsPane, /external scan delta/);
  });

  test("flow pane expands the map above lower cards during focus mode", () => {
    const flowPane = extractSection("function FlowPane", "function KpiCard");
    assert.match(flowPane, /const \[mindmapFocus, setMindmapFocus\] = useState\(\{ layer: 'root' \}\)/);
    assert.match(flowPane, /const \[historyExpanded, setHistoryExpanded\] = useState\(\(\) => readPersistedHistoryExpanded\(\)\)/);
    assert.match(flowPane, /const flowMapBaseHeight = 'calc\(52% - 4px\)'/);
    assert.match(flowPane, /overlayActive \? 'calc\(100% - 12px\)' : flowMapBaseHeight/);
    assert.match(flowPane, /<Mindmap motionSpeed=\{1\.4\} refreshTick=\{refreshTick\} onFocusChange=\{setMindmapFocus\}/);
    assert.match(flowPane, /position: 'absolute'/);
    assert.match(flowPane, /overflowY: historyExpanded \? 'auto' : 'hidden'/);
    assert.match(flowPane, /position: historyExpanded \? 'relative' : 'absolute'/);
    assert.match(flowPane, /const lowerPaneTop = 'calc\(52% \+ 4px\)'/);
    assert.match(flowPane, /top: historyExpanded \? undefined : lowerPaneTop/);
    assert.match(flowPane, /bottom: historyExpanded \? undefined : 0/);
    assert.match(flowPane, /const lowerPaneExpandedOffset = 'calc\(52% \+ 10px\)'/);
    assert.match(flowPane, /marginTop: historyExpanded \? lowerPaneExpandedOffset : undefined/);
    assert.match(flowPane, /pointerEvents: overlayActive \? 'none' : 'auto'/);
    assert.match(flowPane, /<OpsStrip fill=\{!historyExpanded\} onExpandedChange=\{setHistoryExpanded\}\/>/);
    assert.match(flowPane, /const aprStrats = STRATEGIES\.filter\(s => s\.status === 'LIVE' && s\.apyPct != null && s\.capUsd\)/);
    assert.match(flowPane, /Merkl live positions use current opportunity APR; other lanes can still fall back to display hints until live APR ingestion lands\./);
  });

  test("app header shows live source and freshness state", () => {
    const utilitySection = extractSection("function fmtWhen", "function normalizeUiStrategyId");
    assert.match(utilitySection, /function formatStatusAge/);
    const appSection = extractSection("function App", "\n\n(() => {");
    assert.match(appSection, /const liveStatus = window\.LIVE_STATUS \|\| \{\}/);
    assert.match(appSection, /const ageLabel = formatStatusAge\(statusAt\)/);
    assert.match(appSection, /liveStatus\.live\s*\?\s*\(liveStatus\.remote \? 'public live' : 'local live'\)/);
    assert.match(appSection, /liveStatus\.source === 'static-snapshot'/);
    assert.match(appSection, /'snapshot fallback'/);
    assert.match(appSection, /'status pending'/);
    assert.match(appSection, /`\$\{sourceLabel\} · \$\{ageLabel\}`/);
  });

  test("live APR lookup prefers exact strategy entries before protocol fallback", () => {
    const liveAprSection = extractSection("function liveAprFor", "function defaultAutoExec", DATA_SOURCE);
    assert.match(liveAprSection, /const strategyEntry = aprMap\[strategy\.id\]/);
    assert.match(liveAprSection, /const entry = strategyEntry \|\| aprMap\[key\] \|\| aprMap\[strategy\.protocol\]/);
  });
});
