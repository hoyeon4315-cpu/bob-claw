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
const MINDMAP_SOURCE = readFileSync(
  join(HERE, "..", "dashboard", "public", "mindmap.jsx"),
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
    assert.match(flowPane, /const HOLDINGS = window\.HOLDINGS \|\| globalThis\.HOLDINGS/);
    assert.match(flowPane, /const STRATEGIES = window\.STRATEGIES \|\| globalThis\.STRATEGIES \|\| \[\]/);
    const labels = ["Open APR", "Paid back", "Payback", "Est. yield"];
    for (const label of labels) {
      assert.match(flowPane, new RegExp(`label:\\s*'${label.replace(" ", "\\s+")}'`));
    }
    assert.match(flowPane, /const totalApr = Number\.isFinite\(liveYieldAprPct\) \? liveYieldAprPct : weightedApyForStrategies\(STRATEGIES\)/);
    assert.match(flowPane, /const strategyYieldUsd = STRATEGIES\.reduce/);
    assert.match(flowPane, /const liveYieldSats = flow\?\.metrics\?\.liveEstimatedYieldSats/);
    assert.match(flowPane, /const liveYieldUsd = flow\?\.metrics\?\.liveEstimatedYieldUsd/);
    assert.match(flowPane, /const liveYieldAprPct = flow\?\.metrics\?\.liveYieldAprPct/);
    assert.match(flowPane, /open APR/);
    assert.match(flowPane, /estimated, not realized/);
    assert.match(flowPane, /\$\{fmtUsdCompact\(carryUsd\)\} pending/);
    assert.doesNotMatch(flowPane, /wallet only · 0 open positions/);
    assert.match(flowPane, /const currentWalletUsd = Number\.isFinite\(HOLDINGS\?\.currentWalletUsd\)/);
    assert.match(flowPane, /const protocolDeployedUsd = Number\.isFinite\(HOLDINGS\?\.protocolDeployedUsd\)/);
    assert.match(flowPane, /const currentTotalUsd = Number\.isFinite\(HOLDINGS\?\.currentTotalUsd\)/);
    assert.match(flowPane, /const estimatedProtocolDeployedUsd = Number\.isFinite\(HOLDINGS\?\.estimatedProtocolDeployedUsd\)/);
    assert.match(flowPane, /const estimatedCurrentTotalUsd = Number\.isFinite\(HOLDINGS\?\.estimatedCurrentTotalUsd\)/);
    assert.match(flowPane, /const verifiedMinimumUsd = Number\.isFinite\(HOLDINGS\?\.verifiedMinimumUsd\)/);
    assert.match(flowPane, /const displayAssetUsd = assetEstimateAvailable \? estimatedCurrentTotalUsd : currentTotalUsd/);
    assert.match(flowPane, /const protocolTrackingGapUsd = Number\.isFinite\(HOLDINGS\?\.protocolTrackingGapUsd\)/);
    assert.match(flowPane, /const protocolTrackingGapSub = protocolTrackingGapUsd > 1/);
    assert.match(flowPane, /`\$\{fmtUsdCompact\(currentWalletUsd\)\} free \+ \$\{fmtUsdCompact\(estimatedProtocolDeployedUsd\)\} est\. protocols = \$\{fmtUsdCompact\(estimatedCurrentTotalUsd\)\} est\. · verified floor \$\{fmtUsdCompact\(verifiedMinimumUsd\)\}`/);
    assert.match(flowPane, /const assetHasReconciliationGap = protocolTrackingGapUsd > 1 \|\| Boolean\(HOLDINGS\?\.accountingWarning\)/);
    assert.match(flowPane, /const assetIsVerifiedFloor = HOLDINGS\?\.assetConfidence === 'verified_minimum'/);
    assert.match(flowPane, /const assetMetricLabel = assetEstimateAvailable \? 'Assets' : assetHasReconciliationGap \? 'Observed' : 'Total'/);
    assert.match(flowPane, /const assetMain = pending \? '—' : fmtUsd\(displayAssetUsd \|\| 0\)/);
    assert.match(flowPane, /unreconciled protocol estimate/);
    assert.doesNotMatch(flowPane, /assetIsVerifiedFloor \? '\\\+' : ''/);
    assert.match(flowPane, /verified floor/);
    assert.doesNotMatch(flowPane, /full total unknown/);
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

  test("defi home surfaces the live lane without exposing signing controls", () => {
    const liveLane = extractSection("function LiveLaneCard", "function RouteNode");
    assert.match(liveLane, /Live lane/);
    assert.match(liveLane, /Operation gate/);
    assert.match(liveLane, /Autopilot/);
    assert.match(liveLane, /Execution/);
    assert.match(liveLane, /No tx/);
    assert.match(liveLane, /txBroadcastCount/);
    assert.match(liveLane, /noTxReason/);
    assert.match(liveLane, /Radar/);
    assert.match(liveLane, /Policy candidate/);
    assert.match(liveLane, /read-only · no signing/);
    assert.match(liveLane, /Ladder/);
    assert.match(liveLane, /canaryLadder/);
    assert.match(liveLane, /auto sizing/);
    assert.match(liveLane, /Payback/);
    assert.match(liveLane, /Allowed/);
    assert.match(liveLane, /window\.STATUS/);
    assert.match(liveLane, /window\.OPERATIONS/);
    assert.doesNotMatch(liveLane, /private key/i);
    assert.doesNotMatch(liveLane, /sign transaction/i);

    const flowPane = extractSection("function FlowPane", "function KpiCard");
    assert.doesNotMatch(flowPane, /<LiveLaneCard\/>/);

    const defiPane = extractSection("function DefiPane", "function OnchainRadarCard");
    assert.match(defiPane, /<LiveLaneCard\/>/);
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

    const activityStatusSection = extractSection("function activityStatusLabel", "function activityAmount");
    assert.match(activityStatusSection, /function activityHasSentTx\(activity\)/);
    assert.match(activityStatusSection, /status === 'rejected' && !activityHasSentTx\(activity\)/);
    assert.match(activityStatusSection, /return 'No tx sent'/);

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
    assert.match(opsStrip, /const scrollInsideCard = fill && expanded/);
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
    assert.match(opsStrip, /overflow:\s*'hidden'/);
    assert.match(opsStrip, /flex:\s*scrollInsideCard \? '1 1 auto' : fill \? '1 1 auto' : '0 0 auto'/);
    assert.match(opsStrip, /overflowY:\s*scrollInsideCard \? 'auto' : 'visible'/);
    assert.match(opsStrip, /overscrollBehavior:\s*'contain'/);
    assert.match(opsStrip, /display: 'flex', flexDirection: 'column'/);
  });

  test("zoom focus intentionally lets the map cover first-screen cards while expanded history owns collapse", () => {
    const flowPane = extractSection("function FlowPane", "function KpiCard");
    assert.match(flowPane, /zIndex: historyExpanded \? 1 : 4/);
    assert.match(flowPane, /zIndex: historyExpanded \? 6 : 1/);
    assert.match(flowPane, /const lowerPanePointerEvents = historyExpanded \? 'auto' : \(overlayActive \? 'none' : 'auto'\)/);
    assert.match(flowPane, /opacity: historyExpanded \? 1 : \(overlayActive \? 0\.28 : 1\)/);
    assert.match(flowPane, /pointerEvents: historyExpanded \? 'none' : 'auto'/);
    assert.match(flowPane, /\{!historyExpanded && <FlowMetricGrid cards=\{\[/);
    assert.match(flowPane, /\{!historyExpanded && aprOpen && \(/);
    assert.match(flowPane, /<OpsStrip fill=\{historyExpanded\} onExpandedChange=\{setHistoryExpanded\}\/>/);
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
    assert.match(defiPane, /<LiveLaneCard\/>/);
    assert.match(defiPane, /<PnlBreakdownStrip inline\/>/);
    assert.match(defiPane, /No live strategies/);
    assert.match(defiPane, /live position/);
    assert.match(defiPane, /Cap \$/);
    assert.match(defiPane, /const protoApy = weightedApyForStrategies\(list\)/);
    assert.match(defiPane, /APR \{fmtPct\(protoApy\)\}/);
    assert.match(defiPane, /fmtYieldTag/);
    assert.match(defiPane, /fmtYieldSubLabel/);

    const strategyRow = extractSection("function StrategyRow", "function AssetsPane");
    assert.match(strategyRow, /APR/);
    assert.match(strategyRow, /fmtYieldTag\(s\.earnedUsd, s\.yieldBasis\)/);
    assert.doesNotMatch(strategyRow, /[가-힣]/);
    assert.doesNotMatch(strategyRow, /badge/i);
  });

  test("assets pane shows open position count alongside wallet and deployed balances", () => {
    const scanErrorBrief = extractSection("function walletScanErrorBrief", "function AssetsPane");
    assert.match(scanErrorBrief, /provider.*429/);
    assert.match(scanErrorBrief, /chain.*RPC/);

    const assetsPane = extractSection("function AssetsPane", "function App");
    assert.match(assetsPane, /const HOLDINGS = window\.HOLDINGS \|\| globalThis\.HOLDINGS/);
    assert.match(assetsPane, /const STRATEGIES = window\.STRATEGIES \|\| globalThis\.STRATEGIES \|\| \[\]/);
    assert.match(assetsPane, /Current total assets/);
    assert.match(assetsPane, /Observed assets/);
    assert.match(assetsPane, /Estimated total assets/);
    assert.match(assetsPane, /const assetIsVerifiedFloor = HOLDINGS\?\.assetConfidence === 'verified_minimum'/);
    assert.match(assetsPane, /const assetHasReconciliationGap = protocolTrackingGapUsd > 1 \|\| Boolean\(HOLDINGS\?\.accountingWarning\)/);
    assert.match(assetsPane, /const estimatedProtocolDeployedUsd = Number\.isFinite\(HOLDINGS\?\.estimatedProtocolDeployedUsd\)/);
    assert.match(assetsPane, /const estimatedCurrentTotalUsd = Number\.isFinite\(HOLDINGS\?\.estimatedCurrentTotalUsd\)/);
    assert.match(assetsPane, /const verifiedMinimumUsd = Number\.isFinite\(HOLDINGS\?\.verifiedMinimumUsd\)/);
    assert.match(assetsPane, /const assetHeadline = tracking && !Number\.isFinite\(trackingExactTotalUsd\)/);
    assert.match(assetsPane, /const assetMain = pending \? '—' : fmtUsd\(displayAssetUsd\)/);
    assert.match(assetsPane, /const assetEquationTotalLabel = tracking && !Number\.isFinite\(trackingExactTotalUsd\)/);
    assert.match(assetsPane, /current total/);
    assert.match(assetsPane, /verified minimum \{fmtUsd\(verifiedMinimumUsd\)\}/);
    assert.doesNotMatch(assetsPane, /full-wallet gap/);
    assert.match(assetsPane, /capital refill target/);
    assert.match(assetsPane, /not wallet assets/);
    assert.match(assetsPane, /open positions \{positions\.length\}/);
    assert.match(assetsPane, /const currentWalletUsd = Number\.isFinite\(HOLDINGS\?\.currentWalletUsd\)/);
    assert.match(assetsPane, /const protocolDeployedUsd = Number\.isFinite\(HOLDINGS\?\.protocolDeployedUsd\)/);
    assert.match(assetsPane, /const currentTotalUsd = Number\.isFinite\(HOLDINGS\?\.currentTotalUsd\)/);
    assert.match(assetsPane, /const protocolTrackingGapUsd = Number\.isFinite\(HOLDINGS\?\.protocolTrackingGapUsd\)/);
    assert.match(assetsPane, /estimated live/);
    assert.match(assetsPane, /remaining \{fmtUsd\(currentWalletUsd\)\} \+ \{assetEstimateAvailable \? 'estimated' : 'tracked'\} protocols/);
    assert.match(assetsPane, /= \{assetEquationTotalLabel\} \{fmtUsd\(displayAssetUsd\)\}/);
    assert.match(assetsPane, /unreconciled protocol estimate \{fmtUsd\(protocolTrackingGapUsd\)\}/);
    assert.match(assetsPane, /protocol tracking gap \{fmtUsd\(protocolTrackingGapUsd\)\}/);
    assert.match(assetsPane, /live supported \{fmtUsd\(HOLDINGS\?\.walletUsd\)\}/);
    assert.doesNotMatch(assetsPane, /cached full \$\{fmtUsd\(HOLDINGS\.fullWalletUsd\)\}/);
    assert.match(assetsPane, /const walletScanErrorDetails = \(HOLDINGS\?\.walletScanErrors \|\| \[\]\)/);
    assert.match(assetsPane, /scan errors \$\{HOLDINGS\.walletScanErrorCount\}\$\{walletScanErrorDetails\.length/);
    assert.match(assetsPane, /capital refill target \$\{fmtUsd\(HOLDINGS\.capitalPlanRefillRequiredUsd\)\} · not wallet assets/);
    assert.match(assetsPane, /plan need above verified \$\{HOLDINGS\.executorEstimateDeltaUsd > 0 \? '\+' : ''\}\$\{fmtUsd\(HOLDINGS\.executorEstimateDeltaUsd\)\}/);
    assert.match(assetsPane, /system confidence \$\{HOLDINGS\.systemConfidence\}/);
    assert.match(assetsPane, /audit alerts \$\{HOLDINGS\.invariantViolationCount\}/);
    assert.match(assetsPane, /audit clean/);
    assert.match(assetsPane, /protocol marks current \$\{HOLDINGS\?\.currentProtocolMarkCount \|\| 0\} · issues \$\{HOLDINGS\?\.protocolMarkIssueCount \|\| 0\}/);
    assert.match(assetsPane, /needs adapter \$\{HOLDINGS\.adapterCoverageGapCount\}/);
    assert.match(assetsPane, /signer settling \$\{HOLDINGS\.pendingSignerActionCount\}/);
    assert.match(assetsPane, /HOLDINGS\?\.accountingWarning \? '#FFF6E8'/);
    assert.doesNotMatch(assetsPane, /full wallet live/);
    assert.match(assetsPane, /supported-assets live/);
    assert.match(assetsPane, /policy inventory/);
    assert.match(assetsPane, /wallet observed \$\{formatStatusAge\(HOLDINGS\.walletObservedAt\) \|\| fmtWhen\(HOLDINGS\.walletObservedAt\)\}/);
    assert.match(assetsPane, /scan errors \$\{HOLDINGS\.walletScanErrorCount\}/);
    assert.match(assetsPane, /scan clean/);
    assert.doesNotMatch(assetsPane, /external address scan inactive/);
    assert.match(assetsPane, /external reference \$\{fmtUsd\(HOLDINGS\?\.externalWalletUsd\)\}/);
    assert.doesNotMatch(assetsPane, /verified supported live/);
    assert.doesNotMatch(assetsPane, /full wallet \$\{HOLDINGS\.fullWalletStale \? 'cached' : 'observed'\}/);
    const chainLabel = extractSection("function WalletBalanceChainLabel", "function AssetsPane");
    assert.match(chainLabel, /<ChainLogo id=\{normalized\} size=\{11\}/);
    assert.match(assetsPane, /unclassified \$\{fmtUsd\(HOLDINGS\.unclassifiedUsd\)\}/);
    assert.match(assetsPane, /const isExternalDelta = symBase === 'other' \|\| a\.family === 'external_unclassified'/);
    assert.match(assetsPane, /external scan delta/);
    assert.match(APP_SOURCE, /function protocolTrackingLabel\(position = \{\}\)/);
    assert.match(APP_SOURCE, /function protocolTrackingTone\(position = \{\}\)/);
    assert.match(assetsPane, /protocolTrackingLabel\(p\)/);
    assert.match(assetsPane, /String\(p\.markConfidence\)\.replace\(\/_\/g, ' '\)/);
    assert.match(assetsPane, /mark \{formatStatusAge\(p\.markObservedAt\) \|\| fmtWhen\(p\.markObservedAt\)\}/);
  });

  test("flow pane expands the map above lower cards during focus mode", () => {
    const flowPane = extractSection("function FlowPane", "function KpiCard");
    assert.match(flowPane, /const \[mindmapFocus, setMindmapFocus\] = useState\(\{ layer: 'root' \}\)/);
    assert.match(flowPane, /const \[historyExpanded, setHistoryExpanded\] = useState\(\(\) => readPersistedHistoryExpanded\(\)\)/);
    assert.match(flowPane, /const flowMapBaseHeight = 'calc\(52% - 4px\)'/);
    assert.match(flowPane, /historyExpanded \? flowMapBaseHeight : overlayActive \? 'calc\(100% - 12px\)' : flowMapBaseHeight/);
    assert.match(flowPane, /<Mindmap motionSpeed=\{1\.4\} refreshTick=\{refreshTick\} onFocusChange=\{setMindmapFocus\}/);
    assert.match(flowPane, /position: 'absolute'/);
    assert.match(flowPane, /overflowY: 'hidden'/);
    assert.match(flowPane, /position: 'absolute'/);
    assert.match(flowPane, /const lowerPaneTop = 'calc\(52% \+ 4px\)'/);
    assert.match(flowPane, /top: lowerPaneTop/);
    assert.match(flowPane, /bottom: 0/);
    assert.match(flowPane, /const lowerPaneExpandedOffset = 'calc\(52% \+ 10px\)'/);
    assert.match(flowPane, /paddingTop: historyExpanded \? 0 : undefined/);
    assert.match(flowPane, /const lowerPanePointerEvents = historyExpanded \? 'auto' : \(overlayActive \? 'none' : 'auto'\)/);
    assert.match(flowPane, /transform: historyExpanded \? 'translateY\(0\) scale\(1\)' : overlayActive \? 'translateY\(18px\) scale\(0\.985\)' : 'translateY\(0\) scale\(1\)'/);
    assert.match(flowPane, /<OpsStrip fill=\{historyExpanded\} onExpandedChange=\{setHistoryExpanded\}\/>/);
    assert.match(flowPane, /const totalApr = Number\.isFinite\(liveYieldAprPct\) \? liveYieldAprPct : weightedApyForStrategies\(STRATEGIES\)/);
    assert.match(flowPane, /open APR estimate only/);
    assert.match(flowPane, /not realized PnL or payback/);
  });

  test("app header shows only the requested compact product mark", () => {
    const utilitySection = extractSection("function fmtWhen", "function normalizeUiStrategyId");
    assert.match(utilitySection, /function formatStatusAge/);
    const appSection = extractSection("function App", "\n\n(() => {");
    assert.match(appSection, /<div className="title">BOB CLAW🦞<\/div>/);
    assert.doesNotMatch(appSection, /sourceLabel/);
    assert.doesNotMatch(appSection, /public live/);
    assert.doesNotMatch(appSection, /local live/);
  });

  test("data adapter prefers live transport before static snapshots", () => {
    const dataSelection = extractSection("function selectPreferredStatusPayload", "async function fetchEndpointStatus", DATA_SOURCE);
    assert.match(dataSelection, /const sourceDiff = statusSourceRank\(right\.source\) - statusSourceRank\(left\.source\)/);
    assert.match(dataSelection, /if \(sourceDiff !== 0\) return sourceDiff/);
    assert.ok(
      dataSelection.indexOf("sourceDiff") < dataSelection.indexOf("generatedAtDiff"),
      "live source rank must be evaluated before generatedAt so static snapshots cannot beat a live endpoint",
    );

    const bootstrap = extractSection("async function bootstrapDashboardData", "function setupDashboardRefreshHooks", DATA_SOURCE);
    assert.match(bootstrap, /const initialSnapshot = await fetchStatusPayload\(\)/);
    assert.doesNotMatch(bootstrap, /fetchStaticStatusPayload\(\)/);

    const stream = extractSection("function setupLiveEventStream", "function liveAprFor", DATA_SOURCE);
    assert.match(stream, /const preferRemoteStream = window\.LIVE_STATUS\?\.remote === true/);
    assert.match(stream, /preferRemoteStream && runtime\?\.enabled && runtime\.eventsUrl/);
  });

  test("data adapter treats stale full-wallet scans as reference, not primary display value", () => {
    const adapter = extractSection("const liveApr = holdings?.protocolApr || {};", "  const STRATEGIES = Array.from", DATA_SOURCE);
    assert.match(adapter, /const assetTracking = status\?\.assetTracking \|\| null;/);
    assert.match(adapter, /const summaryDisplayWalletUsd = Number\.isFinite\(capitalSummary\?\.walletUsd\)/);
    assert.match(adapter, /displayWalletUsd: summaryDisplayWalletUsd/);
    assert.match(adapter, /displayTotalUsd: summaryDisplayTotalUsd/);
    assert.match(adapter, /currentWalletUsd: summaryCurrentWalletUsd/);
    assert.match(adapter, /protocolDeployedUsd: summaryProtocolDeployedUsd/);
    assert.match(adapter, /currentTotalUsd: summaryCurrentTotalUsd/);
    assert.match(adapter, /estimatedProtocolDeployedUsd: summaryEstimatedProtocolDeployedUsd/);
    assert.match(adapter, /estimatedCurrentTotalUsd: summaryEstimatedCurrentTotalUsd/);
    assert.match(adapter, /verifiedMinimumUsd: summaryVerifiedMinimumUsd/);
    assert.match(adapter, /estimatedUntrackedProtocolUsd: summaryEstimatedUntrackedProtocolUsd/);
    assert.match(adapter, /estimatedTotalUsdSource: capitalSummary\.estimatedTotalUsdSource \|\| null/);
    assert.match(adapter, /capitalPlanRefillRequiredUsd: Number\.isFinite\(capitalSummary\.capitalPlanRefillRequiredUsd\)/);
    assert.match(adapter, /assetFormula: capitalSummary\.assetFormula \|\| 'current_wallet_plus_protocol_positions'/);
    assert.match(adapter, /const summaryNeedsReconciliation =/);
    assert.match(adapter, /const summaryAssetConfidence = capitalSummary\?\.assetConfidence \|\| \(summaryNeedsReconciliation \? 'verified_minimum' : 'verified_current'\)/);
    assert.match(DATA_SOURCE, /function hasDashboardCapital\(status = null\)/);
    assert.match(DATA_SOURCE, /Number\.isFinite\(status\.capitalSummary\.currentTotalUsd\)/);
    assert.match(DATA_SOURCE, /status\.capitalSummary\.assetConfidence/);
    assert.match(DATA_SOURCE, /const complete = available\.filter\(\(candidate\) => hasDashboardCapital\(candidate\.status\)\)/);
    assert.match(adapter, /referenceFullWalletGapUsd: summaryReferenceFullWalletGapUsd/);
    assert.match(adapter, /planGapUsd: summaryPlanGapUsd/);
    assert.match(adapter, /protocolTrackingGapUsd: summaryProtocolTrackingGapUsd/);
    assert.match(adapter, /trackingGapUsd: summaryProtocolTrackingGapUsd/);
    assert.match(adapter, /reconciliationGapUsd: Number\.isFinite\(capitalSummary\.reconciliationGapUsd\) \? capitalSummary\.reconciliationGapUsd : null/);
    assert.match(adapter, /assetTracking: assetTracking \? \{/);
    assert.match(adapter, /exactTotalUsd: Number\.isFinite\(assetTracking\.exactTotalUsd\) \? assetTracking\.exactTotalUsd : null/);
    assert.match(adapter, /riskUsableUsd: Number\.isFinite\(assetTracking\.riskUsableUsd\) \? assetTracking\.riskUsableUsd : null/);
    assert.match(adapter, /systemConfidence: capitalSummary\.systemConfidence \|\| \(summaryAssetConfidence === 'verified_current' \? 'high' : 'medium'\)/);
    assert.match(adapter, /autoExecutionSafe: capitalSummary\.autoExecutionSafe === true/);
    assert.match(adapter, /invariantViolations: Array\.isArray\(capitalSummary\.invariantViolations\) \? capitalSummary\.invariantViolations : \[\]/);
    assert.match(adapter, /adapterCoverageGapCount: Number\.isFinite\(capitalSummary\.adapterCoverageGapCount\) \? capitalSummary\.adapterCoverageGapCount : 0/);
    assert.match(adapter, /currentProtocolMarkCount: Number\.isFinite\(capitalSummary\.currentProtocolMarkCount\) \? capitalSummary\.currentProtocolMarkCount : 0/);
    assert.match(adapter, /protocolMarkIssueCount: Number\.isFinite\(capitalSummary\.protocolMarkIssueCount\) \? capitalSummary\.protocolMarkIssueCount : 0/);
    assert.match(adapter, /supported_wallet_plus_positions_cached_external_reference/);
    assert.match(adapter, /const fallbackDisplayWalletUsd = Number\.isFinite\(holdings\?\.totalUsd\) \? holdings\.totalUsd : null/);
    assert.doesNotMatch(adapter, /hasFreshFullWalletSummary/);
    assert.doesNotMatch(adapter, /hasFreshFullWalletFallback/);
    assert.doesNotMatch(adapter, /displayWalletUsd: Number\.isFinite\(capitalSummary\.displayWalletUsd\) \? capitalSummary\.displayWalletUsd : null/);
  });

  test("asset pane surfaces exact tracking blockers instead of implying total certainty", () => {
    const assetsPane = extractSection("function AssetsPane", "function App");
    assert.match(assetsPane, /const tracking = HOLDINGS\?\.assetTracking \|\| null/);
    assert.match(assetsPane, /const trackingExactTotalUsd = Number\.isFinite\(tracking\?\.exactTotalUsd\) \? tracking\.exactTotalUsd : null/);
    assert.match(assetsPane, /const trackingRiskUsableUsd = Number\.isFinite\(tracking\?\.riskUsableUsd\) \? tracking\.riskUsableUsd : null/);
    assert.match(assetsPane, /trackingRiskReady \? 'risk-ready exact' : 'not exact for sizing'/);
    assert.match(assetsPane, /trackingBlockers\.slice\(0, 3\)\.map/);
  });

  test("data adapter keeps wallet and protocol capital split for map cards", () => {
    const capitalMaps = extractSection("function buildCapitalMaps", "function timestampMs", DATA_SOURCE);
    assert.match(capitalMaps, /const walletByChain = \{\}/);
    assert.match(capitalMaps, /const deployedByChain = \{\}/);
    assert.match(capitalMaps, /accumulateUsd\(walletByChain, item\?\.chain \|\| null, Number\(item\?\.usd\)\)/);
    assert.match(capitalMaps, /accumulateUsd\(deployedByChain, item\?\.chain \|\| null, usd\)/);
    assert.match(capitalMaps, /walletByChain,/);
    assert.match(capitalMaps, /deployedByChain,/);
  });

  test("data adapter separates active live positions from policy-ready and activity-only surfaces", () => {
    const statusSection = extractSection("function activeStrategyStatus", "function deriveStatus", DATA_SOURCE);
    assert.match(statusSection, /if \(hasLivePosition\) return 'LIVE'/);
    assert.match(statusSection, /if \(isLiveCandidate\) return 'POLICY READY'/);
    assert.match(statusSection, /if \(hasRecentActivity\) return 'ACTIVITY'/);

    const strategyMapping = extractSection("const STRATEGIES = Array.from", "const grossProfitSats", DATA_SOURCE);
    assert.match(strategyMapping, /const hasLivePosition = protocolCapitalUsd > 0/);
    assert.match(strategyMapping, /const hasRecentActivity = Number\(activitySurface\?\.count \|\| 0\) > 0/);
    assert.match(strategyMapping, /activeStrategyStatus\(\{/);
    assert.match(strategyMapping, /activitySurfaceCount: activitySurface\?\.count \|\| 0/);
  });

  test("data mapper promotes active protocol positions into mindmap strategies", () => {
    assert.match(DATA_SOURCE, /function normalizeProtocolPositionStrategy\(position = \{\}/);
    assert.match(DATA_SOURCE, /const positionStrategies = \(HOLDINGS\.positions \|\| \[\]\)/);
    assert.match(DATA_SOURCE, /source: 'protocol_position'/);
    assert.match(DATA_SOURCE, /activeStrategyState: 'live_position'/);
    assert.match(DATA_SOURCE, /STRATEGIES\.push\(\.\.\.positionStrategies\)/);
    assert.match(DATA_SOURCE, /actualProtocolCapitalUsd: Number\.isFinite\(position\.usd\)/);
  });

  test("data mapper does not promote wrapped native asset labels as protocols", () => {
    assert.match(DATA_SOURCE, /const NON_PROTOCOL_ACTIVITY_IDS = new Set\(\[/);
    assert.match(DATA_SOURCE, /'wrapped_native'/);
    assert.match(DATA_SOURCE, /function isDisplayableProtocolId\(protocol\)/);
    assert.match(DATA_SOURCE, /if \(!chain \|\| !protocol \|\| !isDisplayableProtocolId\(protocol\)\) continue;/);
  });

  test("mindmap root view keeps protocol nodes hidden until chain zoom", () => {
    assert.doesNotMatch(MINDMAP_SOURCE, /function RootProtocolHint\(/);
    assert.doesNotMatch(MINDMAP_SOURCE, /rootProtocolHints/);
    assert.doesNotMatch(MINDMAP_SOURCE, /data-root-protocol/);
    assert.match(MINDMAP_SOURCE, /selectedChain && \(protocolsByChain\[selectedChain\] \|\| \[\]\)\.map/);
  });

  test("data refresh exposes RAW_STATUS through window.STATUS for live UI cards", () => {
    const assignSection = extractSection("Object.assign(window, {", "});\n  window._DASHBOARD_LIVE_AVAILABLE", DATA_SOURCE);
    assert.match(assignSection, /STATUS: status/);
    assert.match(assignSection, /RAW_STATUS: status/);
    assert.match(assignSection, /RADAR: status\?\.radar \|\| null/);
    assert.match(assignSection, /generatedAt: status\?\.liveTransport\?\.servedAt \|\| status\?\.capitalSummary\?\.generatedAt \|\| status\?\.generatedAt \|\| null/);
  });

  test("live APR lookup prefers exact strategy entries before protocol fallback", () => {
    const liveAprSection = extractSection("function liveAprFor", "function defaultAutoExec", DATA_SOURCE);
    assert.match(liveAprSection, /const strategyEntry = aprMap\[strategy\.id\]/);
    assert.match(liveAprSection, /const entry = strategyEntry \|\| aprMap\[key\] \|\| aprMap\[strategy\.protocol\]/);
  });

  test("defi pane includes the read-only onchain radar card", () => {
    const radarCard = extractSection("function OnchainRadarCard", "function DevAgentQueueCard");
    assert.match(radarCard, /window\.RADAR \|\| window\.STATUS\?\.radar/);
    assert.match(radarCard, /Onchain radar/);
    assert.match(radarCard, /read-only · no signing/);
    assert.match(radarCard, /label: 'Observed'/);
    assert.match(radarCard, /label: 'Portable'/);
    assert.match(radarCard, /label: 'Policy review'/);
    assert.match(radarCard, /capReview/);
    assert.match(radarCard, /No signing path/);
    assert.match(radarCard, /<TriCard compact cells=\{\[/);

    const defiPane = extractSection("function DefiPane", "function pairTokens");
    assert.match(defiPane, /<OnchainRadarCard\/>/);
    assert.doesNotMatch(defiPane, /<ResearchFunnelCard\/>/);
  });
});
