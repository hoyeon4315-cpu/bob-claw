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
import { chainPriceCaption, chainPriceExtremes, referenceMarketPrice } from "./market-display.js";
import { buildOverfitDisplay } from "./overfit-display.js";
import { buildUpdateSummary } from "./update-summary.js";
import { buildWatchlistDisplay } from "./watchlist-display.js";

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

function compactMoney(value) {
  if (!Number.isFinite(value)) return null;
  if (value >= 1000) {
    const compact = value / 1000;
    const digits = compact >= 100 ? 0 : 1;
    return `$${compact.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: digits })}k`;
  }
  if (value >= 1) return `$${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}`;
  return `$${value.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}`;
}

function signedPct(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("ko-KR", { maximumFractionDigits: digits })}%`;
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
  const radius = compact ? (width <= 390 ? 320 : 350) : 390;
  sorted.forEach((chain, index) => {
    const angle = Math.PI + (index / Math.max(sorted.length, 1)) * Math.PI * 2;
    positions[chain] = {
      x: positions[gatewayNode].x + Math.cos(angle) * radius,
      y: positions[gatewayNode].y + Math.sin(angle) * radius,
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

function renderNodes(scene, positions, status) {
  const layer = $("chainLayer");
  clear(layer);
  const marketPrices = status.market?.chainWbtcPrices || [];
  const priceByChain = new Map(marketPrices.map((item) => [item.chain, item]));
  const priceClasses = chainPriceExtremes(marketPrices);

  const nodes = [gatewayNode, ...scene.displayChains];
  for (const chain of nodes) {
    const pos = positions[chain];
    if (!pos) continue;
    const node = document.createElement("div");
    const pending = chain !== gatewayNode && scene.pendingChains.includes(chain);
    node.className = `chain-node ${chain === gatewayNode ? "gateway-node" : ""} ${pending ? "pending-node" : ""}`;
    node.style.left = `${(pos.x / viewBoxWidth) * 100}%`;
    node.style.top = `${(pos.y / viewBoxHeight) * 100}%`;
    const priceInfo = chain !== gatewayNode ? chainPriceCaption(priceByChain.get(chain) || null, chain, status.market) : null;
    const priceClass =
      chain !== gatewayNode
        ? [priceClasses.get(chain) || "", priceInfo?.stale ? "stale" : "", priceInfo?.variant === "reference" ? "price-reference" : ""]
            .filter(Boolean)
            .join(" ")
        : "";
    node.innerHTML = `
      <span class="chain-pin">
        <img src="${iconFor(chain)}" alt="${labelFor(chain)} logo">
      </span>
      <strong>${labelFor(chain)}</strong>
      ${
        chain !== gatewayNode && priceInfo
          ? `<span class="chain-price ${priceClass}"><span class="chain-price-value">${escapeHtml(priceInfo.value)}</span>${
              priceInfo.delta ? `<span class="chain-price-delta">${escapeHtml(priceInfo.delta)}</span>` : ""
            }${
              priceInfo.note ? `<span class="chain-price-note">${escapeHtml(priceInfo.note)}</span>` : ""
            }</span>`
          : ""
      }
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
    empty.textContent = "최근 흐름이 아직 없습니다.";
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
      <span>${event.direction === "btc_out" ? "BTC 이동" : event.direction === "btc_in" ? "BTC 복귀" : "체인 흐름"}</span>
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

function renderPnl(status) {
  const pnl = status.pnl || {};
  const grid = $("pnlGrid");
  clear(grid);
  const realized = pnl.realized?.valueUsd;
  $("pnlBadge").textContent = Number.isFinite(realized)
    ? `${realized >= 0 ? "+" : ""}${money(realized)}`
    : pnl.estimated?.valueUsd != null
      ? "추정치"
      : "대기 중";

  const cards = [
    {
      label: "Paper",
      title: Number.isFinite(pnl.paper?.valueUsd) ? money(pnl.paper.valueUsd) : "—",
      detail: pnl.paper?.detail || "관측 데이터 대기",
      subline: pnl.paper?.routeLabel || "관측 기준 없음",
      tone: "paper",
    },
    {
      label: "Estimated",
      title: Number.isFinite(pnl.estimated?.valueUsd) ? money(pnl.estimated.valueUsd) : "—",
      detail: pnl.estimated?.detail || "검토 경로 대기",
      subline: pnl.estimated?.routeLabel || "실행 검토 없음",
      tone: "estimated",
    },
    {
      label: "Realized",
      title: Number.isFinite(realized) ? money(realized) : "—",
      detail: pnl.realized?.detail || "아직 receipt 기록 없음",
      subline:
        Number.isFinite(pnl.realized?.tradeCount) || Number.isFinite(pnl.realized?.failedCount)
          ? `확정 ${pnl.realized?.tradeCount || 0} · 실패 ${pnl.realized?.failedCount || 0}`
          : "실현 기록 대기",
      tone: "realized",
    },
  ];

  for (const item of cards) {
    const card = document.createElement("div");
    card.className = `pnl-card ${item.tone}`;
    card.innerHTML = `
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.detail)}</p>
      <small>${escapeHtml(item.subline)}</small>
    `;
    grid.append(card);
  }
}

function renderTradeHistory(status) {
  const tradeHistory = status.tradeHistory || {};
  const items = tradeHistory.items || [];
  $("tradeHistoryBadge").textContent = `${items.length}건`;
  const list = $("tradeHistory");
  clear(list);

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "trade-item trade-empty";
    empty.innerHTML = `
      <strong>아직 실제 거래 기록이 없습니다</strong>
      <span>receipt 또는 실행 이벤트가 생기면 최근 기록이 여기에 표시됩니다.</span>
    `;
    list.append(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = `trade-item ${item.status || "pending"}`;
    row.innerHTML = `
      <div class="trade-item-main">
        <strong>${escapeHtml(item.statusLabel || "기록")}</strong>
        <span>${escapeHtml(item.chainLabel || item.chain || "chain")} · ${compactAge(item.observedAt)}</span>
      </div>
      <div class="trade-item-meta">
        <span>${escapeHtml(item.routeLabel || item.txHashShort || "route pending")}</span>
        <span>${item.amount ? `${escapeHtml(amountText(item.amount))} sats` : "amount pending"}</span>
      </div>
      <div class="trade-item-pnl">
        <strong>${Number.isFinite(item.realizedNetPnlUsd) ? money(item.realizedNetPnlUsd) : Number.isFinite(item.estimatedNetPnlUsd) ? money(item.estimatedNetPnlUsd) : "—"}</strong>
        <span>${Number.isFinite(item.realizedNetPnlUsd) ? "realized" : Number.isFinite(item.estimatedNetPnlUsd) ? "estimated" : "pending"}</span>
      </div>
    `;
    list.append(row);
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

  const watchlist = buildWatchlistDisplay(status.gateway?.btcWatchlist || null);
  $("btcWatchlistBadge").textContent = watchlist.badge;
  $("btcWatchlistObserved").textContent = watchlist.observedText;
  $("btcWatchlistMissing").textContent = watchlist.missingText;
  $("btcWatchlistUnknown").textContent = watchlist.unknownText;
}

function renderOpportunity(status) {
  const opportunity = status.opportunity || {};
  const candidates = opportunity.candidateCount || 0;
  $("opportunityBadge").textContent = `후보 ${candidates}`;
  const hasScores = (opportunity.scoredQuotes || 0) > 0;
  if (!hasScores) {
    $("opportunityTitle").textContent = "아직 점수화 전입니다";
    $("opportunityBody").textContent = "신선한 호가와 비용 데이터를 기다리는 중입니다.";
    return;
  }

  if (candidates > 0) {
    $("opportunityTitle").textContent = "수동 검토 후보가 있습니다";
    $("opportunityBody").textContent = `${candidates}개 경로를 사람이 다시 확인한 뒤 다음 단계로 넘기면 됩니다.`;
    return;
  }

  const topGap = opportunity.dataGaps?.[0];
  const rejected = opportunity.rejectedNoEdge || 0;
  const highFailure = opportunity.highFailureRate || 0;
  const dexQuotes = status.dex?.recentQuotes24h || 0;
  const dexBacked = opportunity.dexBacked || 0;
  const quotePrefix = dexQuotes ? `${opportunity.scoredQuotes} gateway · ${dexBacked}/${dexQuotes} DEX 확인` : `${opportunity.scoredQuotes} quotes`;
  $("opportunityTitle").textContent = "아직 깨끗한 엣지는 없습니다";
  $("opportunityBody").textContent = topGap
    ? `${quotePrefix} · ${humanGap(topGap.gap)}`
    : highFailure
      ? `${quotePrefix} · 불안정 경로 ${highFailure}개`
      : `${quotePrefix} · 비용 반영 후 제외 ${rejected}개`;
}

function renderManualMemos(status) {
  const memos = status.manualMemos || [];
  const levelLabel = {
    now: "바로 보기",
    next: "다음 확인",
    later: "나중 점검",
  };
  $("manualMemoBadge").textContent = `${memos.length}개`;
  const list = $("manualMemos");
  clear(list);

  if (!memos.length) {
    const empty = document.createElement("div");
    empty.className = "memo-card memo-empty";
    empty.innerHTML = `
      <strong>중요한 수동 메모 없음</strong>
      <p>다음 확인이 필요해지면 여기서 바로 볼 수 있습니다.</p>
    `;
    list.append(empty);
    return;
  }

  for (const memo of memos) {
    const item = document.createElement("div");
    item.className = "memo-card";
    item.innerHTML = `
      <div class="memo-top">
        <span class="memo-when">${escapeHtml(memo.whenLabel || "다음 확인 때")}</span>
        <span class="memo-level">${escapeHtml(levelLabel[memo.level] || "다음 확인")}</span>
      </div>
      <strong>${escapeHtml(memo.title || "메모")}</strong>
      <p>${escapeHtml(memo.summary || "")}</p>
      ${memo.detail ? `<div class="memo-detail">${escapeHtml(memo.detail)}</div>` : ""}
      ${memo.command ? `<div class="memo-row"><span>명령</span><code>${escapeHtml(memo.command)}</code></div>` : ""}
      ${memo.prompt ? `<div class="memo-row"><span>프롬프트</span><code>${escapeHtml(memo.prompt)}</code></div>` : ""}
    `;
    list.append(item);
  }
}

function renderQuoteLag(status) {
  const lag = status.quoteLag;
  const badge = $("quoteLagBadge");
  const title = $("quoteLagTitle");
  const body = $("quoteLagBody");
  const probesEl = $("quoteLagProbes");
  const samplesEl = $("quoteLagSamples");
  const maxEl = $("quoteLagMax");
  const profitableEl = $("quoteLagProfitable");
  const priceRangeEl = $("quoteLagPriceRange");

  if (!lag || lag.sampleCount === 0) {
    badge.textContent = "대기 중";
    title.textContent = "호가 지연 측정 대기";
    body.textContent = "npm run collect:quote-lag 으로 수집을 시작하세요.";
    probesEl.innerHTML = "";
    samplesEl.textContent = "0";
    maxEl.textContent = "—";
    profitableEl.textContent = "0건";
    priceRangeEl.textContent = "—";
    return;
  }

  const verdictMap = {
    profitable_dislocations_found: "🟢 기회 발견",
    no_profitable_dislocations: "측정 중",
    no_data: "대기 중",
  };
  badge.textContent = verdictMap[lag.verdict] || lag.verdict;

  const ageMin = lag.latestSampleAt
    ? Math.round((Date.now() - new Date(lag.latestSampleAt).getTime()) / 60000)
    : null;
  const freshLabel = ageMin !== null ? `${ageMin}분 전 갱신` : "";
  const ls = lag.lagStats;

  if (lag.verdict === "profitable_dislocations_found") {
    title.textContent = `수익 기회 ${ls.profitableSampleCount}건 발견!`;
    body.textContent = `최대 엣지 ${ls.maxEdgePct}% · ${lag.sampleCount}건 수집 · ${freshLabel}`;
  } else {
    title.textContent = "호가 지연 측정 중";
    body.textContent = `${lag.sampleCount}건 수집 · 최대 엣지 ${ls.maxEdgePct ?? 0}% · ${freshLabel}`;
  }

  const probeStats = lag.probeStats || [];
  probesEl.innerHTML = probeStats
    .map((p) => {
      const edgeVal = p.maxEdgePct ?? p.maxLagPct;
      const edgeStr = edgeVal !== null ? `${edgeVal > 0 ? "+" : ""}${edgeVal.toFixed(3)}%` : "n/a";
      const netClass = p.profitableCount > 0 ? "positive" : "negative";
      const profLabel = p.profitableCount > 0 ? `🟢 ${p.profitableCount}건` : "—";
      return `<div class="lag-probe">
        <span class="lag-probe-label">${p.label}</span>
        <span class="lag-probe-lag">${edgeStr}</span>
        <span class="lag-probe-net ${netClass}">${profLabel}</span>
      </div>`;
    })
    .join("");

  samplesEl.textContent = lag.sampleCount.toLocaleString();
  maxEl.textContent = ls.maxEdgePct !== null ? `${ls.maxEdgePct}%` : (ls.maxLagPct !== null ? `${ls.maxLagPct}%` : "—");
  profitableEl.textContent = `${ls.profitableSampleCount}건 (${ls.profitableSamplePct}%)`;

  const pr = lag.btcPriceRange;
  priceRangeEl.textContent =
    pr.min !== null && pr.max !== null
      ? `$${pr.min.toLocaleString()} – $${pr.max.toLocaleString()}`
      : "—";
}

function renderDexSpread(status) {
  const ds = status.dexSpread;
  const badge = $("dexSpreadBadge");
  const title = $("dexSpreadTitle");
  const body = $("dexSpreadBody");
  const tokensEl = $("dexSpreadTokens");
  const maxEl = $("dexSpreadMax");
  const lbtcEl = $("dexSpreadLbtc");
  const samplesEl = $("dexSpreadSamples");
  const bestEl = $("dexSpreadBest");

  if (!ds || !ds.tokens) {
    badge.textContent = "대기 중";
    title.textContent = "Multi-Chain BTC 스프레드";
    body.textContent = "npm run collect:dex-spreads 로 수집을 시작하세요.";
    tokensEl.innerHTML = "";
    return;
  }

  const ageMin = ds.observedAt
    ? Math.round((Date.now() - new Date(ds.observedAt).getTime()) / 60000)
    : null;
  const freshLabel = ageMin !== null ? `${ageMin}분 전` : "";
  const chainCount = ds.chainCount || 1;

  const hasAlert = ds.alerts?.length > 0;
  const isWide = ds.spreadPct > 0.3;
  badge.textContent = hasAlert ? "🚨 알림" : isWide ? "🟢 스프레드 확대" : "측정 중";

  const btcTag = ds.btcSpotUsd ? ` · BTC $${Math.round(ds.btcSpotUsd).toLocaleString()} (${ds.btcChange24hPct >= 0 ? "+" : ""}${ds.btcChange24hPct}%)` : "";
  title.textContent = `${chainCount}체인 스프레드 ${ds.spreadPct.toFixed(3)}% · LBTC +${(ds.lbtcPremiumPct || 0).toFixed(3)}%`;
  body.textContent = `${ds.probeBtc} BTC 기준 · ${ds.tokenCount || 0}개 토큰 · ${freshLabel}${btcTag}`;

  const tokens = (ds.tokens || []).filter(t => !t.error && t.impact < 10);
  tokens.sort((a, b) => (b.netUsdc || 0) - (a.netUsdc || 0));
  tokensEl.innerHTML = tokens.map(t => {
    const net = `$${t.netUsdc.toFixed(2)}`;
    const chain = t.chain || "base";
    const gas = `$${t.gasUsd.toFixed(3)}`;
    const isTop = `${t.chain}:${t.symbol}` === ds.bestToken || t.symbol === ds.bestToken;
    return `<div class="lag-probe${isTop ? " probe-best" : ""}">
      <span class="lag-probe-label">${chain}:${t.symbol}</span>
      <span class="lag-probe-lag">${net}</span>
      <span class="lag-probe-net">gas ${gas}</span>
    </div>`;
  }).join("");

  // Alert banner
  if (hasAlert) {
    const alertHtml = ds.alerts.map(a => {
      const val = typeof a.value === "number" ? a.value.toFixed(3) + "%" : a.value;
      return `<div style="color:#ff4444;font-weight:bold;padding:4px 0">🚨 ${a.type}: ${val}</div>`;
    }).join("");
    tokensEl.insertAdjacentHTML("afterbegin", alertHtml);
  }

  maxEl.textContent = `${ds.spreadPct.toFixed(3)}%${ds.summary?.spread?.max != null ? ` (max ${ds.summary.spread.max.toFixed(3)}%)` : ""}`;
  lbtcEl.textContent = ds.lbtcPremiumPct != null ? `${ds.lbtcPremiumPct.toFixed(3)}%` : "—";
  samplesEl.textContent = ds.summary?.sampleCount?.toLocaleString() || "1";
  bestEl.textContent = ds.bestToken || "—";
}

function renderUpdate(status) {
  const summary = buildUpdateSummary(status);
  $("updateBadge").textContent = summary.badge;
  $("updateTitle").textContent = summary.title;
  $("updateBody").textContent = summary.body;
  const overfit = buildOverfitDisplay(status.audit || null);
  $("overfitBadge").textContent = overfit.badge;
  $("overfitTitle").textContent = overfit.title;
  $("overfitBody").textContent = overfit.body;
}

function renderSystemStatus(status) {
  const ds = status.dexSpread;
  const badge = $("volBadge");
  const priceEl = $("volPrice");
  const changeEl = $("volChange");
  const alertIcon = $("volAlertIcon");
  const turboIcon = $("volTurboIcon");
  const samplesEl = $("volSamples");
  const spreadRangeEl = $("volSpreadRange");
  const freshnessEl = $("volFreshness");
  const alertDetailEl = $("volAlertDetail");

  if (!ds || ds.btcSpotUsd == null) {
    badge.textContent = "대기 중";
    priceEl.textContent = "—";
    changeEl.textContent = "";
    return;
  }

  // BTC price + 24h change
  priceEl.textContent = `$${Math.round(ds.btcSpotUsd).toLocaleString()}`;
  const pct = ds.btcChange24hPct ?? 0;
  const sign = pct >= 0 ? "+" : "";
  changeEl.textContent = `${sign}${pct.toFixed(2)}%`;
  changeEl.className = `vol-change ${pct >= 0 ? "up" : "down"}`;

  // Alerts
  const alerts = ds.alerts || [];
  const hasAlert = alerts.length > 0;
  alertIcon.textContent = hasAlert ? "🚨" : "✅";
  alertDetailEl.textContent = hasAlert
    ? alerts.map(a => a.type || a.label || "alert").join(", ")
    : "없음";

  // Turbo: show if spread is very wide (> 0.5%)
  const turboActive = ds.spreadPct > 0.5;
  turboIcon.style.display = turboActive ? "inline" : "none";

  // Badge
  badge.textContent = hasAlert ? "🚨 변동" : turboActive ? "🔥 터보" : "✅ 안정";

  // Samples
  const sc = ds.summary?.sampleCount ?? 1;
  samplesEl.textContent = sc.toLocaleString();

  // Spread range
  const sp = ds.summary?.spread;
  spreadRangeEl.textContent = sp
    ? `${sp.min.toFixed(3)}% – ${sp.max.toFixed(3)}%`
    : "—";

  // Freshness
  if (ds.observedAt) {
    const ageMin = Math.round((Date.now() - new Date(ds.observedAt).getTime()) / 60000);
    freshnessEl.textContent = ageMin < 1 ? "방금 전" : `${ageMin}분 전`;
  } else {
    freshnessEl.textContent = "—";
  }
}

function renderHeader(status) {
  $("liveCopy").textContent = `자동 갱신 · ${compactAge(status.generatedAt)}`;

  const memos = status.manualMemos || [];
  const recentEvents = status.gateway?.recentFlowEvents || [];
  const reference = referenceMarketPrice(status.market || {});
  const btcChange = status.dexSpread?.btcChange24hPct ?? null;
  const walletUsd = status.shadowCycle?.treasury?.estimatedWalletUsd;
  const chains = status.gateway.chains?.length || 0;
  const headlineCopy = [];
  if (Number.isFinite(walletUsd)) headlineCopy.push(`지갑 추정 ${money(walletUsd)}`);
  if (memos.length) headlineCopy.push(`중요 메모 ${memos.length}건`);
  if (status.shadowCycle?.headline) headlineCopy.push(status.shadowCycle.headline);
  $("stageSummaryCopy").textContent = headlineCopy.join(" · ") || "실시간 흐름과 다음 확인 메모를 보고 있습니다.";

  $("heroRoutes").textContent = `${status.gateway.routeCount || 0}`;
  $("heroRoutesSub").textContent = `${chains}개 체인`;
  $("heroPrice").textContent = reference?.usd ? money(reference.usd) : "—";
  $("heroPriceSub").textContent = Number.isFinite(btcChange) ? `24h ${signedPct(btcChange)}` : "24h 확인 중";
  $("heroActivity").textContent = `${recentEvents.length}`;
  $("heroActivitySub").textContent = recentEvents.length ? `최근 ${Math.min(recentEvents.length, 5)}개` : "흐름 대기";
  $("heroMemos").textContent = `${memos.length}`;
  $("heroMemosSub").textContent = memos[0]?.whenLabel || "다음 확인";
}

function render(status) {
  lastStatus = status;
  const scene = buildSceneModel(status);
  const positions = nodePositions(scene.displayChains);
  renderHeader(status);
  renderLines(scene, positions);
  renderNodes(scene, positions, status);
  renderPnl(status);
  renderTradeHistory(status);
  renderTimeline(status);
  renderGas(status);
  renderAssetCoverage(status);
  renderOpportunity(status);
  renderManualMemos(status);
  renderQuoteLag(status);
  renderDexSpread(status);
  renderSystemStatus(status);
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
    const summary = $("stageSummaryCopy");
    if (summary) summary.textContent = "다음 갱신을 기다리고 있습니다.";
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
