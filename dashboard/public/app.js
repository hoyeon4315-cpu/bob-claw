const statusUrl = "./dashboard-status.json";
const svgNs = "http://www.w3.org/2000/svg";
const refreshMs = 60_000;

const TONE_COLORS = {
  "tone-btc": "#f7931a",
  "tone-gateway": "#ff7b23",
  "tone-wrapped": "#4d84ff",
  "tone-stable": "#2ccdb6",
  "tone-eth": "#9fa9f5",
  "tone-blocked": "#ff6e63",
  "tone-watch": "#ffd166",
  "tone-observe": "#79b7ff",
  "tone-blueprint": "#4de2ff",
};

const TOKENS = {
  btc: { label: "BTC", domain: "bitcoin.org" },
  wbtc: { label: "WBTC", domain: "wbtc.network" },
  wbtcOft: { label: "wBTC.OFT", domain: "wbtc.network", tag: "OFT" },
  uniBtc: { label: "uniBTC", domain: "gobob.xyz", tag: "BOB" },
  usdc: { label: "USDC", domain: "circle.com" },
  usdt: { label: "USDT", domain: "tether.to" },
  eth: { label: "ETH", domain: "ethereum.org" },
  lbtc: { label: "LBTC", domain: "lombard.finance" },
  cbbtc: { label: "cbBTC", domain: "coinbase.com" },
  tbtc: { label: "tBTC", domain: "threshold.network" },
};

const CHAINS = {
  avalanche: { label: "Avalanche", domain: "avax.network" },
  base: { label: "Base", domain: "base.org" },
  bera: { label: "Berachain", domain: "berachain.com" },
  bitcoin: { label: "Bitcoin", domain: "bitcoin.org" },
  bob: { label: "BOB Mainnet", domain: "gobob.xyz" },
  bsc: { label: "BNB Chain", domain: "bnbchain.org" },
  ethereum: { label: "Ethereum", domain: "ethereum.org" },
};

const PROTOCOLS = {
  gateway: { label: "BOB Gateway", domain: "gobob.xyz" },
  dolomite: { label: "Dolomite", domain: "dolomite.io" },
  moonwell: { label: "Moonwell", domain: "moonwell.fi" },
  aerodrome: { label: "Aerodrome", domain: "aerodrome.finance" },
};

let lastStatus = null;
let resizeFrame = null;

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function iconForDomain(domain) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`;
}

function relativeAge(value) {
  if (!value) return "unknown";
  const delta = Math.max(0, Date.now() - new Date(value).getTime());
  const seconds = Math.round(delta / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function compactNumber(value) {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("en-US");
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return null;
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: Math.abs(value) < 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function findPivot(status, id) {
  return status?.strategy?.pivotPlan?.pivots?.find((item) => item.id === id) || null;
}

function findTrack(status, kind) {
  return status?.strategy?.strategyTracks?.tracks?.find((item) => item.kind === kind) || null;
}

function pillMeta(label, toneClass) {
  return { label, toneClass };
}

function statusMeta(code) {
  const normalized = String(code || "").toLowerCase();
  const table = {
    allowed: { label: "Open", toneClass: "tone-blueprint" },
    blocked: { label: "Blocked", toneClass: "tone-blocked" },
    reject_no_net_edge: { label: "Blocked", toneClass: "tone-blocked" },
    blocked_current_surface: { label: "Blocked", toneClass: "tone-blocked" },
    blocked_policy_or_overfit: { label: "Blocked", toneClass: "tone-blocked" },
    blocked_nonrefreshable_input: { label: "Blocked", toneClass: "tone-blocked" },
    hold_dex_quote: { label: "Held", toneClass: "tone-blocked" },
    thin_coverage: { label: "Thin coverage", toneClass: "tone-watch" },
    measured_below_policy: { label: "Below policy", toneClass: "tone-watch" },
    research_only: { label: "Research", toneClass: "tone-watch" },
    analysis_only: { label: "Analysis only", toneClass: "tone-watch" },
    refresh_exact_gas: { label: "Refresh needed", toneClass: "tone-watch" },
    pre_execution_blueprint: { label: "Blueprint", toneClass: "tone-blueprint" },
    unobserved: { label: "Observe only", toneClass: "tone-observe" },
    watch_eth_family_surface: { label: "Observe only", toneClass: "tone-observe" },
    no_measured_loops: { label: "Observe only", toneClass: "tone-observe" },
  };
  return table[normalized] || { label: humanizeCode(code), toneClass: "tone-watch" };
}

function humanizeCode(code) {
  if (!code) return "Unknown";
  return String(code).replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function humanizePreliveStage(stage) {
  return {
    shadow_replay: "Shadow replay",
    mechanical_simulation: "Mechanical simulation",
    fork_execution: "Fork execution",
    tiny_canary: "Tiny live canary",
  }[stage] || humanizeCode(stage || "shadow_replay");
}

function humanizeReason(reason) {
  return {
    reject_no_net_edge: "the measured unwind is still negative",
    blocked_nonrefreshable_input: "a connected input is still blocked",
    stale_gas_snapshots: "gas inputs are stale",
    amount_mismatch: "the entry and exit size ladders do not line up",
    partial_amount_match: "the amount coverage is still too thin to trust",
    latest_flash_negative: "the latest measured triangle is net negative",
    no_measured_loops: "no exact closed loop clears policy yet",
    no_multichain_eth_family_surface: "there is still no measured ETH family cross-chain surface",
    external_reference_workflow_requires_deterministic_adaptation: "the lane is still a design blueprint",
  }[reason] || humanizeCode(reason);
}

function tokenMark(tokenKey) {
  const token = TOKENS[tokenKey];
  if (!token) return "";
  return `
    <span class="token-mark" data-tag="${escapeHtml(token.tag || "")}" title="${escapeHtml(token.label)}">
      <img src="${iconForDomain(token.domain)}" alt="${escapeHtml(token.label)}">
    </span>
  `;
}

function tokenStack(tokenKeys, extraClass = "") {
  return `
    <span class="token-stack ${escapeHtml(extraClass)}">
      ${tokenKeys.map((item) => tokenMark(item)).join("")}
    </span>
  `;
}

function chainPill(chainKey) {
  const chain = CHAINS[chainKey];
  if (!chain) return "";
  return `
    <span class="chain-pill">
      <span class="chain-mark"><img src="${iconForDomain(chain.domain)}" alt="${escapeHtml(chain.label)}"></span>
      ${escapeHtml(chain.label)}
    </span>
  `;
}

function protocolMark(protocolKey, large = false) {
  const protocol = PROTOCOLS[protocolKey];
  if (!protocol) return "";
  return `
    <span class="protocol-mark ${large ? "protocol-mark-large" : ""}">
      <img src="${iconForDomain(protocol.domain)}" alt="${escapeHtml(protocol.label)}">
    </span>
  `;
}

function renderFlow(flow, toneClass) {
  const parts = [];
  flow.items.forEach((item, index) => {
    parts.push(`<span class="flow-item ${item.kind === "note" ? "flow-note" : ""}">${renderFlowItem(item)}</span>`);
    if (index < flow.items.length - 1) {
      parts.push(`<span class="flow-arrow ${escapeHtml(toneClass)}"></span>`);
    }
  });
  if (flow.returnLabel) {
    parts.push(`<span class="flow-arrow flow-return ${escapeHtml(toneClass)}"></span>`);
    parts.push(`<span class="flow-return-label">${escapeHtml(flow.returnLabel)}</span>`);
  }
  return `<div class="detail-flow">${parts.join("")}</div>`;
}

function renderFlowItem(item) {
  if (item.type === "tokens") return `${tokenStack(item.tokens)}<span>${escapeHtml(item.label)}</span>`;
  if (item.type === "token") return `${tokenMark(item.token)}<span>${escapeHtml(item.label)}</span>`;
  if (item.type === "protocol") return `${protocolMark(item.protocol)}<span>${escapeHtml(item.label)}</span>`;
  return escapeHtml(item.label);
}

function buildModel(status) {
  const liveTrading = status?.overall?.liveTrading || "BLOCKED";
  const stage = status?.prelive?.validation?.currentStageId || status?.strategy?.strategySnapshot?.preliveStage || "shadow_replay";
  const activeCanary = status?.canaryAdvance?.final?.routeLabel || status?.prelive?.reviewPackage?.routeLabel || "No active canary";
  const canaryReason = status?.canaryAdvance?.final?.reasons?.[0] || status?.prelive?.currentRoutePrelivePass?.latestStatus || null;
  const gatewayObservedAt = status?.gateway?.observedAt || status?.generatedAt || null;
  const chainCount = status?.gateway?.chainCount || status?.gateway?.chains?.length || 0;
  const strategyCount = status?.strategy?.strategySnapshot?.implementedStrategyCount || 0;
  const wrappedLoops = findPivot(status, "gateway_wrapped_btc_loops");
  const baseYield = findPivot(status, "gateway_base_btc_yield");
  const proxySpreads = findPivot(status, "btc_proxy_spreads");
  const stableLoops = findPivot(status, "stablecoin_entry_exit_loops");
  const triangle = findPivot(status, "triangular_flash_btc");
  const stableTrack = findTrack(status, "stable_loop");
  const proxyTrack = findTrack(status, "proxy_spread");
  const ethTrack = findTrack(status, "eth_family_loop");
  const ethProfitability = status?.strategy?.ethProfitability || null;
  const pnlPaper = formatUsd(status?.pnl?.paper?.valueUsd);

  return {
    heroSummary:
      `Native BTC is mapped through wrapped BTC, stablecoin, and ETH-like rails across the public BOB Gateway surface. ` +
      `This is a strategy map, not a live-trading approval screen.`,
    headline:
      `${humanizePreliveStage(stage)} is still the official stage. The active canary stays held until the measured route clears its real unwind.`,
    meta: `Public snapshot ${relativeAge(status?.generatedAt || gatewayObservedAt)}`,
    safetyLine:
      `Live trading stays ${liveTrading.toLowerCase()} while routes remain inside review and canary validation.`,
    sourceCoverage: `${compactNumber(chainCount)} chains are visible in the public Gateway surface right now.`,
    gatewayState: statusMeta(liveTrading).label,
    heroPills: [
      pillMeta(`Live ${liveTrading.toLowerCase()}`, liveTrading === "BLOCKED" ? "tone-blocked" : "tone-blueprint"),
      pillMeta(humanizePreliveStage(stage), "tone-observe"),
      pillMeta("Active canary held", "tone-gateway"),
      pillMeta(`${compactNumber(chainCount)} chains`, "tone-wrapped"),
    ],
    gatewayMetrics: [
      `${compactNumber(status?.gateway?.routeCount || 0)} public routes`,
      `${compactNumber(strategyCount)} mapped strategy surfaces`,
      status?.overall?.shadowTrading === "ALLOWED" ? "Shadow observation is allowed" : "Shadow observation is blocked",
      pnlPaper ? `Paper PnL ${pnlPaper}` : "Paper PnL unavailable",
    ],
    rails: [
      {
        id: "wrapped",
        title: "Wrapped BTC Rail",
        toneClass: "tone-wrapped",
        summary:
          "BTC lands as wBTC.OFT, WBTC, or uniBTC before it is looped, parked, or rebalanced.",
        noteChips: ["Loops", "Yield blueprints", "Proxy spreads"],
        tokens: ["btc", "wbtcOft", "wbtc", "uniBtc"],
        cards: [
          {
            id: "wrapped-loop",
            toneClass: statusMeta(canaryReason || wrappedLoops?.status).toneClass,
            badge: statusMeta(canaryReason || wrappedLoops?.status).label,
            protocol: "dolomite",
            title: "Wrapped BTC Loop · Active Canary",
            chains: ["avalanche", "bera"],
            copy:
              "Wrapped BTC crosses into Berachain, then tests a lending-style unwind before the loop is treated as real.",
            flow: {
              items: [
                { type: "token", token: "wbtcOft", label: "wBTC.OFT" },
                { type: "protocol", protocol: "dolomite", label: "Supply on Dolomite" },
                { type: "note", label: "Borrow stable leg" },
                { type: "token", token: "wbtcOft", label: "Rebuy BTC side" },
              ],
              returnLabel: "Only the full return to the BTC side counts.",
            },
            stateText:
              `${activeCanary} is currently held because ${humanizeReason(canaryReason)}.`,
          },
          {
            id: "yield-base",
            toneClass: statusMeta(baseYield?.status).toneClass,
            badge: statusMeta(baseYield?.status).label,
            protocol: "moonwell",
            title: "Base BTC Yield Blueprint",
            chains: ["bitcoin", "base"],
            copy:
              "This is the clearest Base-side BTC yield idea today, but it is still a blueprint rather than an execution-ready route.",
            flow: {
              items: [
                { type: "token", token: "btc", label: "Native BTC" },
                { type: "token", token: "wbtcOft", label: "Gateway wrap" },
                { type: "protocol", protocol: "moonwell", label: "Deploy on Moonwell" },
                { type: "note", label: "Measure BTC-denominated yield" },
              ],
            },
            stateText: `${humanizeReason(baseYield?.reason)}.`,
          },
          {
            id: "proxy-spread",
            toneClass: statusMeta(proxyTrack?.status || proxySpreads?.status).toneClass,
            badge: statusMeta(proxyTrack?.status || proxySpreads?.status).label,
            protocol: "gateway",
            title: "Wrapped BTC Proxy Spread",
            chains: ["ethereum", "base", "bsc"],
            copy:
              "This branch watches dislocations between wrapped BTC versions and uses the Gateway as the rebalance bridge.",
            flow: {
              items: [
                { type: "token", token: "wbtc", label: "WBTC" },
                { type: "token", token: "wbtcOft", label: "wBTC.OFT" },
                { type: "token", token: "uniBtc", label: "uniBTC" },
              ],
              returnLabel: "Rebalance only when the wrapped BTC versions line up cleanly.",
            },
            stateText:
              `Current read: ${humanizeReason(proxyTrack?.reason || proxySpreads?.reason)}.`,
          },
        ],
      },
      {
        id: "stable",
        title: "Stablecoin Rail",
        toneClass: "tone-stable",
        summary:
          "Stablecoins are the cleanest entry, exit, and liquidity-pair expression when the map needs a round trip back to BTC.",
        noteChips: ["Entry and exit", "LP pairs", "Mixed triangles"],
        tokens: ["usdc", "usdt", "btc"],
        cards: [
          {
            id: "stable-loop",
            toneClass: statusMeta(stableTrack?.status || stableLoops?.status).toneClass,
            badge: statusMeta(stableTrack?.status || stableLoops?.status).label,
            protocol: "gateway",
            title: "Stable Entry / Exit Loop",
            chains: ["base", "bitcoin"],
            copy:
              "Stablecoins buy BTC on the way in, then the same lane must unwind back into a stable balance on the way out.",
            flow: {
              items: [
                { type: "token", token: "usdc", label: "USDC" },
                { type: "token", token: "btc", label: "BTC" },
                { type: "token", token: "usdc", label: "USDC again" },
              ],
              returnLabel: "The loop is only valid when both sides use comparable size.",
            },
            stateText:
              `Current read: ${humanizeReason(stableTrack?.reason || stableLoops?.reason)}.`,
          },
          {
            id: "lp-base",
            toneClass: statusMeta(stableLoops?.status).toneClass,
            badge: "Below policy",
            protocol: "aerodrome",
            title: "Base LP Pair",
            chains: ["base"],
            copy:
              "The LP branch is shown as the actual pair: wrapped BTC sits next to USDC and only matters if the unwind stays honest.",
            flow: {
              items: [
                { type: "tokens", tokens: ["wbtcOft", "usdc"], label: "wBTC.OFT / USDC pair" },
                { type: "protocol", protocol: "aerodrome", label: "Aerodrome pool" },
                { type: "note", label: "Collect swap fees" },
              ],
            },
            stateText:
              `Pair is visible, but ${humanizeReason(stableLoops?.reason)}.`,
          },
          {
            id: "triangle-base",
            toneClass: statusMeta(triangle?.status).toneClass,
            badge: statusMeta(triangle?.status).label,
            protocol: "gateway",
            title: "Base Mixed BTC Triangle",
            chains: ["base"],
            copy:
              "The triangle branch is shown as the actual token loop under observation instead of an opaque flash-arb label.",
            flow: {
              items: [
                { type: "token", token: "usdc", label: "USDC" },
                { type: "token", token: "tbtc", label: "tBTC" },
                { type: "token", token: "lbtc", label: "LBTC" },
                { type: "token", token: "usdc", label: "Back to USDC" },
              ],
              returnLabel: "Latest measured triangle still comes back below policy.",
            },
            stateText:
              `Current read: ${humanizeReason(triangle?.reason)}.`,
          },
        ],
      },
      {
        id: "eth",
        title: "ETH-like Rail",
        toneClass: "tone-eth",
        summary:
          "ETH-like paths stay on the map as an investigated lane, but remain observation-only in the current USD 300 phase.",
        noteChips: ["Observed only", "No measured edge", "Ethereum L1 disabled"],
        tokens: ["btc", "eth"],
        cards: [
          {
            id: "eth-observe",
            toneClass: statusMeta(ethTrack?.status || ethProfitability?.recommendationCode).toneClass,
            badge: statusMeta(ethTrack?.status || ethProfitability?.recommendationCode).label,
            protocol: "gateway",
            title: "ETH Family Observation Lane",
            chains: ["bitcoin", "base", "ethereum"],
            copy:
              "ETH stays visible so it is not mistaken for skipped work, but there is still no confirmed measured edge here.",
            flow: {
              items: [
                { type: "token", token: "btc", label: "Native BTC" },
                { type: "token", token: "eth", label: "ETH side" },
                { type: "note", label: "Observe only" },
              ],
            },
            stateText:
              `${humanizeReason(ethProfitability?.recommendationCode || ethTrack?.reason)}.`,
          },
        ],
      },
    ],
  };
}

function renderHero(model) {
  $("heroSummary").textContent = model.heroSummary;
  $("stageHeadline").textContent = model.headline;
  $("stageMeta").textContent = model.meta;
  $("sourceTokens").innerHTML = tokenStack(["btc"], "token-stack-large");
  $("sourceCoverage").textContent = model.sourceCoverage;
  $("gatewayMark").innerHTML = protocolMark("gateway", true);
  $("gatewayState").textContent = model.gatewayState;
  $("gatewayMetrics").innerHTML = model.gatewayMetrics
    .map((item) => `<span class="metric-chip">${escapeHtml(item)}</span>`)
    .join("");
  $("heroPills").innerHTML = model.heroPills
    .map((item) => `<span class="hero-pill ${escapeHtml(item.toneClass)}">${escapeHtml(item.label)}</span>`)
    .join("");
  $("safetyLine").textContent = model.safetyLine;
}

function renderRails(model) {
  $("railColumn").innerHTML = model.rails
    .map((rail) => {
      return `
        <section class="rail-section" data-rail="${escapeHtml(rail.id)}">
          <article id="rail-${escapeHtml(rail.id)}" class="map-node rail-node" data-node="rail-${escapeHtml(rail.id)}">
            <div class="node-head">
              <span class="node-kicker">${escapeHtml(rail.title)}</span>
              <span class="status-pill ${escapeHtml(rail.toneClass)}">${escapeHtml(rail.cards.length)} mapped branches</span>
            </div>
            <div class="node-title-row">
              ${tokenStack(rail.tokens, "token-stack-large")}
              <div class="rail-copy">
                <strong>${escapeHtml(rail.title)}</strong>
                <p>${escapeHtml(rail.summary)}</p>
              </div>
            </div>
            <div class="rail-note-row">
              ${rail.noteChips.map((item) => `<span class="rail-note">${escapeHtml(item)}</span>`).join("")}
            </div>
          </article>
          <div class="strategy-grid">
            ${rail.cards
              .map((card) => {
                return `
                  <article id="card-${escapeHtml(card.id)}" class="strategy-card" data-node="card-${escapeHtml(card.id)}">
                    <div class="card-head">
                      <span class="status-pill ${escapeHtml(card.toneClass)}">${escapeHtml(card.badge)}</span>
                      <div class="card-subline">
                        ${card.chains.map((chain) => chainPill(chain)).join("")}
                      </div>
                    </div>
                    <div class="card-headline">
                      ${protocolMark(card.protocol)}
                      <div class="card-title">
                        <strong>${escapeHtml(card.title)}</strong>
                        <span class="card-copy">${escapeHtml(card.copy)}</span>
                      </div>
                    </div>
                    ${renderFlow(card.flow, card.toneClass)}
                    <div class="card-foot">
                      <span class="card-state">${escapeHtml(card.stateText)}</span>
                    </div>
                  </article>
                `;
              })
              .join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function connectorPath(start, end, vertical) {
  if (vertical) {
    const curve = Math.max(36, Math.abs(end.y - start.y) * 0.35);
    return `M ${start.x} ${start.y} C ${start.x} ${start.y + curve}, ${end.x} ${end.y - curve}, ${end.x} ${end.y}`;
  }
  const curve = Math.max(48, Math.abs(end.x - start.x) * 0.34);
  return `M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${end.x - curve} ${end.y}, ${end.x} ${end.y}`;
}

function anchorPoint(element, boardRect, side) {
  const rect = element.getBoundingClientRect();
  const points = {
    left: { x: rect.left - boardRect.left, y: rect.top - boardRect.top + rect.height / 2 },
    right: { x: rect.right - boardRect.left, y: rect.top - boardRect.top + rect.height / 2 },
    top: { x: rect.left - boardRect.left + rect.width / 2, y: rect.top - boardRect.top },
    bottom: { x: rect.left - boardRect.left + rect.width / 2, y: rect.bottom - boardRect.top },
  };
  return points[side];
}

function appendConnector(svg, pathData, toneClass, durationSeconds) {
  const color = TONE_COLORS[toneClass] || "#79b7ff";

  const base = document.createElementNS(svgNs, "path");
  base.setAttribute("d", pathData);
  base.setAttribute("class", "connector-base");
  svg.appendChild(base);

  const flow = document.createElementNS(svgNs, "path");
  flow.setAttribute("d", pathData);
  flow.setAttribute("class", "connector-flow");
  flow.setAttribute("style", `color: ${color};`);
  svg.appendChild(flow);

  const dot = document.createElementNS(svgNs, "circle");
  dot.setAttribute("r", "3.4");
  dot.setAttribute("class", "connector-dot");
  dot.setAttribute("style", `color: ${color};`);
  const motion = document.createElementNS(svgNs, "animateMotion");
  motion.setAttribute("dur", `${durationSeconds}s`);
  motion.setAttribute("repeatCount", "indefinite");
  motion.setAttribute("path", pathData);
  dot.appendChild(motion);
  svg.appendChild(dot);
}

function drawConnectors(model) {
  const board = $("mapBoard");
  const svg = $("flowLayer");
  if (!board || !svg) return;

  const boardRect = board.getBoundingClientRect();
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${boardRect.width} ${boardRect.height}`);

  const vertical = window.matchMedia("(max-width: 980px)").matches;
  const connections = [
    { from: "sourceNode", to: "gatewayNode", toneClass: "tone-btc", duration: 7 },
  ];

  model.rails.forEach((rail, railIndex) => {
    connections.push({
      from: "gatewayNode",
      to: `rail-${rail.id}`,
      toneClass: rail.toneClass,
      duration: 6 + railIndex * 0.6,
    });
    rail.cards.forEach((card, cardIndex) => {
      connections.push({
        from: `rail-${rail.id}`,
        to: `card-${card.id}`,
        toneClass: card.toneClass,
        duration: 5 + cardIndex * 0.55,
      });
    });
  });

  connections.forEach((item) => {
    const from = document.getElementById(item.from);
    const to = document.getElementById(item.to);
    if (!from || !to) return;
    const start = anchorPoint(from, boardRect, vertical ? "bottom" : "right");
    const end = anchorPoint(to, boardRect, vertical ? "top" : "left");
    appendConnector(svg, connectorPath(start, end, vertical), item.toneClass, item.duration);
  });
}

function scheduleConnectorDraw() {
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    if (lastStatus) drawConnectors(buildModel(lastStatus));
  });
}

function bindImageRedraws() {
  document.querySelectorAll("#mapBoard img").forEach((image) => {
    image.addEventListener("load", scheduleConnectorDraw, { once: true });
  });
}

function render(status) {
  lastStatus = status;
  const model = buildModel(status);
  renderHero(model);
  renderRails(model);
  bindImageRedraws();
  drawConnectors(model);
}

async function loadStatus() {
  const response = await fetch(`${statusUrl}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Status request failed: ${response.status}`);
  return response.json();
}

async function refresh() {
  try {
    const status = await loadStatus();
    render(status);
  } catch (error) {
    $("heroSummary").textContent = "Public route map is unavailable right now.";
    $("stageHeadline").textContent = "The dashboard could not load the current public status snapshot.";
    $("stageMeta").textContent = "Load failed";
    $("safetyLine").textContent = String(error?.message || error);
  }
}

window.addEventListener("resize", scheduleConnectorDraw);
window.addEventListener("orientationchange", scheduleConnectorDraw);

refresh();
setInterval(refresh, refreshMs);
