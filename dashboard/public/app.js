import {
  buildSceneModel,
  chainMeta,
  gatewayNode,
  labelFor,
  orderedChains,
  trailLimit,
  viewBoxHeight,
  viewBoxWidth,
} from "./scene-model.js";
import { buildUpdateSummary } from "./update-summary.js";

const statusUrl = "./dashboard-status.json";
const svgNs = "http://www.w3.org/2000/svg";

let lastStatus = null;
let pulseIndex = 0;
let routeTimer = null;
let resizeFrame = null;
let lastMapWidth = null;
let currentAnimationPaths = [];
let currentAnimationPositions = {};

const $ = (id) => document.getElementById(id);

function iconFor(chain) {
  const domain = chainMeta[chain]?.domain || `${chain}.org`;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
}

function fallbackAssetIconSvg(asset) {
  const ticker = asset?.ticker || "?";
  const icon = asset?.icon || "token";
  const palette = {
    btc: ["#f7931a", "#fff4df"],
    wbtc: ["#2d68a8", "#e8f0ff"],
    usdc: ["#2775ca", "#e8f1ff"],
    usdt: ["#26a17b", "#e6f5ef"],
    eth: ["#627eea", "#eef1ff"],
    paxg: ["#b78924", "#fff5d8"],
    xaut: ["#9b7b24", "#fff5d8"],
    native: ["#177245", "#e8f4ee"],
    token: ["#7864b8", "#efecfb"],
  }[icon] || ["#4f5b62", "#eef1f2"];
  const short = ticker.includes("->") ? ticker.split("->").at(-1) : ticker;
  const text = short.length > 5 ? short.slice(0, 5) : short;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="30" fill="${palette[1]}" stroke="${palette[0]}" stroke-width="4"/>
      <text x="32" y="37" text-anchor="middle" font-family="Arial, sans-serif" font-size="${text.length > 4 ? 13 : 16}" font-weight="800" fill="${palette[0]}">${text}</text>
    </svg>
  `;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function assetIconFor(asset) {
  const officialDomains = {
    btc: "bitcoin.org",
    wbtc: "wbtc.network",
    usdc: "circle.com",
    usdt: "tether.to",
    eth: "ethereum.org",
    paxg: "paxos.com",
    xaut: "tether.to",
  };
  const domain = officialDomains[asset?.icon];
  if (domain) return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
  return fallbackAssetIconSvg(asset);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function assetLabel(asset) {
  return asset?.ticker || asset?.src?.ticker || "asset";
}

function assetMark(asset, originChain = null) {
  const primary = asset || {};
  const title = assetLabel(asset);
  return `
    <span class="asset-mark" title="${escapeHtml(title)}">
      <img class="asset-main" src="${assetIconFor(primary)}" alt="${escapeHtml(primary?.ticker || title)}">
      ${
        originChain
          ? `<img class="origin-chain" src="${iconFor(originChain)}" alt="${escapeHtml(labelFor(originChain))} origin">`
          : ""
      }
    </span>
  `;
}

function assetPairMark(asset) {
  if (!asset?.src || !asset?.dst || asset.src.ticker === asset.dst.ticker) return assetMark(asset?.src || asset);
  return `
    <span class="asset-pair" title="${escapeHtml(assetLabel(asset))}">
      ${assetMark(asset.src)}
      <span>→</span>
      ${assetMark(asset.dst)}
    </span>
  `;
}

function assetRouteText(asset) {
  if (!asset?.src || !asset?.dst) return assetLabel(asset);
  if (asset.src.ticker === asset.dst.ticker) return asset.src.ticker;
  return `${asset.src.ticker} -> ${asset.dst.ticker}`;
}

function money(value) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 100) return `$${value.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}`;
  return `$${value.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}`;
}

function amountText(value) {
  const number = Number(value);
  if (Number.isFinite(number)) return number.toLocaleString("ko-KR");
  return value || "-";
}

function compactAge(value) {
  if (!value) return "-";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}초 전`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  return `${Math.round(minutes / 60)}시간 전`;
}

function humanBlocker(blocker) {
  return {
    audit_blocks_live: "새 데이터 확인 중",
    gateway_update_pending_review: "새 경로 확인 중",
    gateway_probe_failures: "일부 경로 응답 불안정",
    missing_gateway_gas_snapshots: "일부 체인 가스 확인 필요",
    stale_gas_snapshots: "가스 정보 갱신 필요",
  }[blocker] || blocker;
}

function humanGap(gap) {
  return {
    bitcoin_network_fee_not_modelled: "Bitcoin fee check needed",
    implausible_quote_value_ratio: "quote value outlier",
    missing_src_token_decimals: "source decimals missing",
    missing_dst_token_decimals: "destination decimals missing",
    missing_src_token_price: "source price missing",
    missing_dst_token_price: "destination price missing",
    missing_src_execution_gas: "source gas missing",
    exact_src_execution_gas_not_estimated: "exact route gas pending",
    stale_src_gas_snapshot: "gas refresh needed",
  }[gap] || gap;
}

function mapMetrics() {
  const map = document.querySelector(".map-wrap");
  const width = map?.clientWidth || window.innerWidth || 390;
  return {
    width,
    compact: width <= 520,
  };
}

function nodePositions(chains) {
  const positions = { [gatewayNode]: { x: viewBoxWidth / 2, y: viewBoxHeight / 2 } };
  const sorted = orderedChains(chains);
  const { width, compact } = mapMetrics();
  const radiusX = compact ? (width <= 390 ? 340 : 350) : 355;
  const radiusY = compact ? (width <= 390 ? 205 : 220) : 235;
  sorted.forEach((chain, index) => {
    const angle = Math.PI + (index / Math.max(sorted.length, 1)) * Math.PI * 2;
    positions[chain] = {
      x: positions[gatewayNode].x + Math.cos(angle) * radiusX,
      y: positions[gatewayNode].y + Math.sin(angle) * radiusY,
    };
  });
  return positions;
}

function straightSegment(start, end) {
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

function clear(el) {
  el.replaceChildren();
}

function renderLines(scene, positions) {
  const svg = $("flowSvg");
  clear(svg);

  const defs = document.createElementNS(svgNs, "defs");
  const markerColors = {
    btc_out: "#d08b19",
    btc_in: "#2d68a8",
    bob_out: "#177245",
    bob_in: "#16847b",
    chain_to_chain: "#7864b8",
  };
  for (const [direction, color] of Object.entries(markerColors)) {
    const marker = document.createElementNS(svgNs, "marker");
    marker.setAttribute("id", `arrow-${direction}`);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "8");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "5");
    marker.setAttribute("markerHeight", "5");
    marker.setAttribute("orient", "auto-start-reverse");
    const markerPath = document.createElementNS(svgNs, "path");
    markerPath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    markerPath.setAttribute("fill", color);
    marker.append(markerPath);
    defs.append(marker);
  }
  svg.append(defs);

  for (const chain of scene.displayChains) {
    const points = [positions[gatewayNode], positions[chain]].filter(Boolean);
    if (points.length < 2) continue;
    const path = document.createElementNS(svgNs, "path");
    const pending = scene.pendingChains.includes(chain);
    path.setAttribute("class", `route-line spoke ${chain === "bitcoin" ? "bitcoin-spoke" : ""} ${pending ? "pending-spoke" : ""}`);
    path.setAttribute("d", straightSegment(points[0], points[1]));
    svg.append(path);
  }
}

function renderNodes(scene, positions) {
  const layer = $("chainLayer");
  clear(layer);

  const nodes = [gatewayNode, ...scene.displayChains];
  for (const chain of nodes) {
    const pos = positions[chain];
    if (!pos) continue;
    const node = document.createElement("div");
    const pending = chain !== gatewayNode && scene.pendingChains.includes(chain);
    node.className = `chain-node ${chain === gatewayNode ? "gateway-node" : ""} ${pending ? "pending-node" : ""}`;
    node.style.left = `${(pos.x / viewBoxWidth) * 100}%`;
    node.style.top = `${(pos.y / viewBoxHeight) * 100}%`;
    node.innerHTML = `
      <span class="chain-pin">
        <img src="${iconFor(chain)}" alt="${labelFor(chain)} logo">
      </span>
      <strong>${labelFor(chain)}</strong>
    `;
    layer.append(node);
  }
}

function pointToPercent(point) {
  return { x: `${(point.x / viewBoxWidth) * 100}%`, y: `${(point.y / viewBoxHeight) * 100}%` };
}

function trimTrails() {
  const trails = [...$("pulseLayer").querySelectorAll(".trail")];
  if (trails.length <= trailLimit) return;
  trails.slice(0, trails.length - trailLimit).forEach((trail) => trail.remove());
}

function makeTrail(point, direction) {
  const trail = document.createElement("span");
  const percent = pointToPercent(point);
  trail.className = `trail ${direction}`;
  trail.style.left = percent.x;
  trail.style.top = percent.y;
  $("pulseLayer").append(trail);
  trimTrails();
  setTimeout(() => trail.remove(), 7_500);
}

function segmentsForRoute(route) {
  const originChain = route.originChain || route.srcChain || route.path?.[0] || null;
  if (route.segments?.length) return route.segments.map((segment) => ({ ...segment, originChain: segment.originChain || originChain }));
  const asset = route.asset || route.assets?.[0] || null;
  const path = route.path || [];
  if (path.length >= 3 && asset?.src && asset?.dst) {
    return [
      { from: path[0], to: path[1], asset: asset.src, originChain },
      { from: path[1], to: path[2], asset: asset.dst, originChain },
    ];
  }
  if (path.length >= 2) return [{ from: path[0], to: path.at(-1), asset: asset?.src || asset, originChain }];
  return [];
}

function animateSegment(segment, positions, direction, delay = 0) {
  const start = positions[segment.from];
  const end = positions[segment.to];
  const asset = segment.asset;
  if (!start || !end) return;
  const pulse = document.createElement("span");
  const p0 = pointToPercent(start);
  const p1 = pointToPercent(end);
  pulse.className = `pulse segment-pulse ${direction} ${asset?.family || ""}`;
  pulse.innerHTML = assetMark(asset, segment.originChain);
  pulse.title = segment.originChain ? `${assetLabel(asset)} from ${labelFor(segment.originChain)}` : assetLabel(asset);
  pulse.style.setProperty("--x0", p0.x);
  pulse.style.setProperty("--y0", p0.y);
  pulse.style.setProperty("--x1", p1.x);
  pulse.style.setProperty("--y1", p1.y);
  pulse.style.setProperty("--duration", "2.7s");
  setTimeout(() => {
    $("pulseLayer").append(pulse);
    makeTrail(start, direction);
    setTimeout(() => makeTrail(end, direction), 2100);
    setTimeout(() => pulse.remove(), 3000);
  }, delay);
}

function animatePath(route, positions) {
  const { direction = "chain_to_chain" } = route;
  const segments = segmentsForRoute(route);
  if (!segments.length) return;
  segments.forEach((segment, index) => animateSegment(segment, positions, direction, index * 1500));
}

function stopAnimationLoop() {
  if (!routeTimer) return;
  clearTimeout(routeTimer);
  routeTimer = null;
}

function runAnimationLoop() {
  if (!currentAnimationPaths.length) {
    stopAnimationLoop();
    return;
  }
  const route = currentAnimationPaths[pulseIndex % currentAnimationPaths.length];
  pulseIndex = (pulseIndex + 1) % currentAnimationPaths.length;
  animatePath(route, currentAnimationPositions);
  routeTimer = setTimeout(runAnimationLoop, 2400);
}

function syncAnimation(scene, positions) {
  currentAnimationPaths = scene.animationPaths;
  currentAnimationPositions = positions;
  if (!currentAnimationPaths.length) {
    stopAnimationLoop();
    return;
  }
  if (routeTimer) return;
  runAnimationLoop();
}

function renderTimeline(status) {
  const events = [...(status.gateway.recentFlowEvents || [])].slice(-5).reverse();
  $("traceCount").textContent = `${events.length}`;
  const timeline = $("timeline");
  clear(timeline);

  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "trace";
    empty.textContent = "최근 흐름을 기다리는 중";
    timeline.append(empty);
    return;
  }

  for (const event of events) {
    const item = document.createElement("div");
    item.className = `trace ${event.direction}`;
    const src = event.path[0];
    const dst = event.path.at(-1);
    item.innerHTML = `
      ${assetPairMark(event.asset)}
      <div>
        <strong>${labelFor(src)} -> BOB Gateway -> ${labelFor(dst)}</strong>
        <span>${compactAge(event.observedAt)} · ${assetRouteText(event.asset)} · ${amountText(event.inputAmount || event.amount)} -> ${amountText(event.outputAmount)}</span>
      </div>
      <span>${event.direction === "btc_out" ? "BTC out" : event.direction === "btc_in" ? "BTC in" : "route"}</span>
    `;
    timeline.append(item);
  }
}

function renderGas(status) {
  const grid = $("gasGrid");
  clear(grid);
  const chains = [...(status.gas.chains || [])]
    .filter((item) => item.chain !== "bitcoin")
    .sort((a, b) => (a.fallbackTxUsd ?? 0) - (b.fallbackTxUsd ?? 0))
    .slice(0, status.bitcoinFee?.latest ? 5 : 6);

  $("gasFreshness").textContent =
    status.gas.missingGatewayGasChainCount || status.gas.staleChainCount30m ? "확인 필요" : "신선함";

  if (status.bitcoinFee?.latest) {
    const fee = status.bitcoinFee.latest;
    const card = document.createElement("div");
    card.className = "mini-card";
    card.innerHTML = `
      <header>
        <img src="${assetIconFor({ icon: "btc", ticker: "BTC" })}" alt="BTC logo">
        <strong>BTC fee</strong>
      </header>
      <span>${money(fee.estimatedFeeUsd)} · ${fee.feeRateSatVb ?? "?"} sat/vB</span>
      <span>${compactAge(fee.observedAt)}</span>
    `;
    grid.append(card);
  }

  for (const chain of chains) {
    const card = document.createElement("div");
    card.className = "mini-card";
    card.innerHTML = `
      <header>
        <img src="${iconFor(chain.chain)}" alt="${labelFor(chain.chain)} logo">
        <strong>${labelFor(chain.chain)}</strong>
      </header>
      <span>gas ${money(chain.fallbackTxUsd)} · native ${money(chain.nativeUsd)}</span>
      <span>${compactAge(chain.observedAt)}</span>
    `;
    grid.append(card);
  }
}

function renderAssetCoverage(status) {
  const coverage = status.gateway.assetCoverage || {};
  const sampled = coverage.sampledAssetCount || 0;
  const supported = coverage.supportedAssetCount || 0;
  $("assetCoverageCount").textContent = `${sampled}/${supported}`;
  const grid = $("assetCoverageGrid");
  clear(grid);

  const sampledAssets = (coverage.sampledAssets || []).slice(0, 5).map((asset) => ({ ...asset, sampled: true }));
  const unsampledAssets = (coverage.unsampledAssets || []).slice(0, 5).map((asset) => ({ ...asset, sampled: false }));
  const assets = [...sampledAssets, ...unsampledAssets].slice(0, 8);

  if (!assets.length) {
    const empty = document.createElement("div");
    empty.className = "asset-row";
    empty.textContent = "Waiting for route inventory";
    grid.append(empty);
    return;
  }

  for (const asset of assets) {
    const row = document.createElement("div");
    row.className = `asset-row ${asset.sampled ? "sampled" : "unsampled"}`;
    row.innerHTML = `
      ${assetMark(asset)}
      <strong>${asset.ticker}</strong>
      <span>${asset.sampled ? `${asset.quoteCount} quotes` : "not sampled"}</span>
    `;
    grid.append(row);
  }
}

function renderOpportunity(status) {
  const opportunity = status.opportunity || {};
  const candidates = opportunity.candidateCount || 0;
  $("opportunityBadge").textContent = `${candidates} clean`;
  const hasScores = (opportunity.scoredQuotes || 0) > 0;
  if (!hasScores) {
    $("opportunityTitle").textContent = "No score yet";
    $("opportunityBody").textContent = "Waiting for fresh quotes and costs.";
    return;
  }

  if (candidates > 0) {
    $("opportunityTitle").textContent = "Review candidate found";
    $("opportunityBody").textContent = `${candidates} route${candidates === 1 ? "" : "s"} need manual review before any canary.`;
    return;
  }

  const topGap = opportunity.dataGaps?.[0];
  const rejected = opportunity.rejectedNoEdge || 0;
  const highFailure = opportunity.highFailureRate || 0;
  const dexQuotes = status.dex?.recentQuotes24h || 0;
  const dexBacked = opportunity.dexBacked || 0;
  const quotePrefix = dexQuotes ? `${opportunity.scoredQuotes} gateway · ${dexBacked}/${dexQuotes} DEX matched` : `${opportunity.scoredQuotes} quotes`;
  $("opportunityTitle").textContent = "No clean edge yet";
  $("opportunityBody").textContent = topGap
    ? `${quotePrefix} · ${humanGap(topGap.gap)}`
    : highFailure
      ? `${quotePrefix} · ${highFailure} unstable routes`
      : `${quotePrefix} · ${rejected} rejected by net cost`;
}

function renderUpdate(status) {
  const summary = buildUpdateSummary(status);
  $("updateBadge").textContent = summary.badge;
  $("updateTitle").textContent = summary.title;
  $("updateBody").textContent = summary.body;
}

function renderHeader(status) {
  const chains = status.gateway.chains?.length || 0;
  $("liveCopy").textContent = `자동 갱신 · ${compactAge(status.generatedAt)}`;
  $("routeHeadline").textContent = `BTC -> BOB -> ${chains}개 체인`;
  $("routeSubline").textContent = status.gateway.updateDetected ? "새 경로 변화 확인 중" : "실시간 경로 관찰 중";
}

function render(status) {
  lastStatus = status;
  const scene = buildSceneModel(status);
  const positions = nodePositions(scene.displayChains);
  renderHeader(status);
  renderLines(scene, positions);
  renderNodes(scene, positions);
  renderTimeline(status);
  renderGas(status);
  renderAssetCoverage(status);
  renderOpportunity(status);
  renderUpdate(status);
  const mapWidth = document.querySelector(".map-wrap")?.clientWidth || null;
  lastMapWidth = mapWidth;
  syncAnimation(scene, positions);
}

async function loadStatus() {
  try {
    const response = await fetch(`${statusUrl}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`status ${response.status}`);
    render(await response.json());
  } catch {
    $("liveCopy").textContent = "상태 파일 대기 중";
    $("routeSubline").textContent = "다음 갱신을 기다리고 있습니다.";
  }
}

loadStatus();
setInterval(loadStatus, 10_000);
window.addEventListener("resize", () => {
  if (!lastStatus) return;
  const mapWidth = document.querySelector(".map-wrap")?.clientWidth || null;
  if (Number.isFinite(mapWidth) && Number.isFinite(lastMapWidth) && Math.abs(mapWidth - lastMapWidth) <= 2) return;
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => render(lastStatus));
});
