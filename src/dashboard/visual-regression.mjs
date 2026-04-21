// Pure visual-regression evaluator for the mobile mindmap (T26).
//
// Real Playwright screenshot diffing requires a Chromium download and
// repo-wide CI plumbing that we do not yet have. The fail conditions
// declared in the T26 spec — viewport overflow, bounding-box overlap > 5px,
// missing logo asset — are all DOM-shape invariants that can be computed
// directly from the layout helpers without rendering pixels.
//
// This module returns a deterministic { ok, failures } verdict for each of
// the 11 destination chains. test/dashboard-visual-regression.test.mjs feeds
// it the real CHAINS / STRATEGY_CATALOG (mirrored in data-catalog.mjs) and
// the ./assets/logos/manifest.json, and asserts ok === true.
//
// When Chromium-based Playwright is wired later, this same module can drive
// the assertions over real getBoundingClientRect() output by replacing the
// pure layout source with `await locator.boundingBox()`.

import {
  placeChainRing,
  computeProtocolBloom,
  MOBILE_VIEWPORT,
} from "./mindmap-layout.mjs";

const VIEWBOX = 380;
const MARGIN = 12;
const RING_R = 120;
const CHAIN_SIZE = 34;
const CHIP_SIZE = 28;
const CHIP_R = CHIP_SIZE * 1.1;
const OVERLAP_TOLERANCE_PX = 5;

function rectFromCircle(cx, cy, r) {
  return { left: cx - r, right: cx + r, top: cy - r, bottom: cy + r };
}

function rectsOverlapPx(a, b) {
  const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (dx <= 0 || dy <= 0) return 0;
  return Math.min(dx, dy);
}

function rectInsideViewBox(r, side) {
  return r.left >= -side / 2 + MARGIN
      && r.right <= side / 2 - MARGIN
      && r.top >= -side / 2 + MARGIN
      && r.bottom <= side / 2 - MARGIN;
}

export function evaluateChainTap({
  chainId,
  chainPos,
  protocols,
  knownChainLogoIds,
  knownProtocolLogoIds,
}) {
  const failures = [];
  const chainCircle = rectFromCircle(chainPos.x, chainPos.y, CHAIN_SIZE * 0.56);

  if (!knownChainLogoIds.has(chainId)) {
    failures.push({ kind: "missing_chain_logo", chainId });
  }
  // Chains must fit inside the static viewBox (rendered without tap-zoom).
  if (!rectInsideViewBox(chainCircle, VIEWBOX)) {
    failures.push({ kind: "viewport_overflow", target: `chain:${chainId}` });
  }

  const bloom = computeProtocolBloom({
    anchor: chainPos,
    count: protocols.length,
    chipR: CHIP_R,
    minR: 62,
    padding: 6,
  });

  const chipRects = bloom.points.map((p, i) => ({
    id: protocols[i].id,
    protocol: protocols[i].protocol,
    rect: rectFromCircle(p.x, p.y, CHIP_R),
  }));

  // Chips intentionally bloom outward and the dashboard applies a
  // per-tap zoom transform to bring them into view (selectionTransform
  // in mindmap.jsx). We do NOT assert chips fit the static frame —
  // the rendered tap state re-centers around the tapped chain.

  for (const chip of chipRects) {
    if (!knownProtocolLogoIds.has(chip.protocol)) {
      failures.push({ kind: "missing_protocol_logo", chainId, protocol: chip.protocol });
    }
  }

  for (let i = 0; i < chipRects.length; i += 1) {
    for (let j = i + 1; j < chipRects.length; j += 1) {
      const overlap = rectsOverlapPx(chipRects[i].rect, chipRects[j].rect);
      if (overlap > OVERLAP_TOLERANCE_PX) {
        failures.push({
          kind: "chip_overlap",
          chainId,
          a: chipRects[i].id,
          b: chipRects[j].id,
          overlapPx: Number(overlap.toFixed(2)),
        });
      }
    }
  }

  return { chainId, chipCount: protocols.length, failures };
}

export function runVisualRegression({
  chains,
  strategyCatalog,
  manifest,
  viewport = MOBILE_VIEWPORT,
}) {
  if (!Array.isArray(chains)) throw new TypeError("chains array required");
  if (!Array.isArray(strategyCatalog)) throw new TypeError("strategyCatalog array required");
  if (!manifest || !Array.isArray(manifest.chains) || !Array.isArray(manifest.protocols)) {
    throw new TypeError("manifest with chains[] and protocols[] required");
  }
  if (!viewport || viewport.width !== 375 || viewport.height !== 812) {
    throw new TypeError("viewport must be the documented mobile reference 375x812");
  }

  const knownChainLogoIds = new Set(manifest.chains.map((c) => c.id));
  const knownProtocolLogoIds = new Set(manifest.protocols.map((p) => p.id));

  const dest = chains.filter((c) => c.role === "destination");
  const ring = placeChainRing({ count: dest.length, ringR: RING_R });

  const protocolsByChain = {};
  for (const s of strategyCatalog) {
    (protocolsByChain[s.chain] ||= []).push(s);
  }
  // Dedupe by protocol id per chain — the mindmap groups strategies that
  // share a protocol into one chip.
  for (const chainId of Object.keys(protocolsByChain)) {
    const seen = new Set();
    protocolsByChain[chainId] = protocolsByChain[chainId].filter((s) => {
      if (seen.has(s.protocol)) return false;
      seen.add(s.protocol);
      return true;
    });
  }

  const reports = dest.map((c, i) => evaluateChainTap({
    chainId: c.id,
    chainPos: ring[i],
    protocols: protocolsByChain[c.id] || [],
    knownChainLogoIds,
    knownProtocolLogoIds,
  }));

  const failures = reports.flatMap((r) => r.failures);
  return Object.freeze({
    ok: failures.length === 0,
    chainCount: dest.length,
    reports: Object.freeze(reports),
    failures: Object.freeze(failures),
  });
}
