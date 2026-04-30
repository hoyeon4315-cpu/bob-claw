// Pure layout helpers for the mobile mindmap (T24).
// Loaded by dashboard/public/mindmap.jsx (mirrored inline because the
// browser bundle is Babel-in-browser, no module resolver). Kept here so
// that overlap and viewport invariants are unit-testable.

export const MOBILE_VIEWPORT = Object.freeze({ width: 375, height: 812 });

export const MINDMAP_FONT_FLOOR_PX = 10;
export const READABLE_FONT_FLOOR_PX = 12;
export const PROTOCOL_BLOOM_SPREAD = Math.PI * 0.92;
export const PROTOCOL_CHIP_SIZE = 30;
export const PROTOCOL_CHIP_RADIUS = PROTOCOL_CHIP_SIZE * 1.12;
export const PROTOCOL_BLOOM_MIN_RADIUS = 112;
export const PROTOCOL_BLOOM_PADDING = 22;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function placeChainRing({ count, ringR, startAngle = -Math.PI / 2 }) {
  if (!Number.isFinite(count) || count <= 0) return [];
  if (!Number.isFinite(ringR) || ringR <= 0) {
    throw new TypeError("placeChainRing: ringR must be a positive finite number");
  }
  const step = (2 * Math.PI) / count;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const a = startAngle + step / 2 + i * step;
    out.push({ index: i, angle: a, x: Math.cos(a) * ringR, y: Math.sin(a) * ringR });
  }
  return out;
}

export function bloomRadiusForCount({ count, chipR, minR = 60, padding = 6 }) {
  if (!Number.isFinite(count) || count <= 0) return minR;
  if (!Number.isFinite(chipR) || chipR <= 0) {
    throw new TypeError("bloomRadiusForCount: chipR must be positive");
  }
  if (count === 1) return minR;
  const gap = PROTOCOL_BLOOM_SPREAD / (count - 1);
  const requiredChord = 2 * chipR + padding;
  const required = requiredChord / (2 * Math.sin(gap / 2));
  return Math.max(minR, required);
}

export function computeProtocolBloom({ anchor, count, chipR, minR = 60, padding = 6 }) {
  if (!anchor || typeof anchor.x !== "number" || typeof anchor.y !== "number") {
    throw new TypeError("computeProtocolBloom: anchor {x,y} required");
  }
  const R = bloomRadiusForCount({ count, chipR, minR, padding });
  const baseA = Math.atan2(anchor.y, anchor.x);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5;
    const a = baseA + t * PROTOCOL_BLOOM_SPREAD;
    out.push({
      index: i,
      x: anchor.x + Math.cos(a) * R,
      y: anchor.y + Math.sin(a) * R,
    });
  }
  return { radius: R, points: out };
}

export function padBounds(bounds, { x = 0, y = x } = {}) {
  if (!bounds || !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)
    || !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY)) {
    throw new TypeError("padBounds: finite bounds required");
  }
  return {
    minX: bounds.minX - x,
    minY: bounds.minY - y,
    maxX: bounds.maxX + x,
    maxY: bounds.maxY + y,
  };
}

export function fitBoundsInViewBox({
  bounds,
  viewBox,
  safeArea,
  focus,
  minZoom = 0.5,
  maxZoom = Infinity,
}) {
  if (!bounds || !viewBox || !safeArea || !focus) {
    throw new TypeError("fitBoundsInViewBox: bounds, viewBox, safeArea, and focus are required");
  }
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const availW = viewBox.width - safeArea.left - safeArea.right;
  const availH = viewBox.height - safeArea.top - safeArea.bottom;
  if (!Number.isFinite(availW) || !Number.isFinite(availH) || availW <= 0 || availH <= 0) {
    throw new TypeError("fitBoundsInViewBox: safeArea must leave positive drawable space");
  }
  const fitZoom = Math.min(availW / width, availH / height);
  const zoom = clamp(fitZoom, minZoom, maxZoom);
  const targetTx = viewBox.width / 2 - focus.x * zoom;
  const targetTy = safeArea.top + availH / 2 - focus.y * zoom;
  const minTx = safeArea.left - bounds.minX * zoom;
  const maxTx = viewBox.width - safeArea.right - bounds.maxX * zoom;
  const minTy = safeArea.top - bounds.minY * zoom;
  const maxTy = viewBox.height - safeArea.bottom - bounds.maxY * zoom;
  const tx = minTx <= maxTx ? clamp(targetTx, minTx, maxTx) : (minTx + maxTx) / 2;
  const ty = minTy <= maxTy ? clamp(targetTy, minTy, maxTy) : (minTy + maxTy) / 2;
  return { zoom, tx, ty, fitZoom };
}

export function isFontSizeReadable(px, { mode = "label" } = {}) {
  if (!Number.isFinite(px)) return false;
  if (mode === "body") return px >= READABLE_FONT_FLOOR_PX;
  return px >= MINDMAP_FONT_FLOOR_PX;
}
