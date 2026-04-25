import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MOBILE_VIEWPORT,
  MINDMAP_FONT_FLOOR_PX,
  READABLE_FONT_FLOOR_PX,
  placeChainRing,
  bloomRadiusForCount,
  computeProtocolBloom,
  padBounds,
  fitBoundsInViewBox,
  isFontSizeReadable,
} from "../src/dashboard/mindmap-layout.mjs";

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("mindmap-layout: viewport + font floors", () => {
  test("mobile viewport fixed at 375x812 (iPhone reference)", () => {
    assert.equal(MOBILE_VIEWPORT.width, 375);
    assert.equal(MOBILE_VIEWPORT.height, 812);
    assert.ok(Object.isFrozen(MOBILE_VIEWPORT));
  });

  test("font floor constants documented", () => {
    assert.equal(MINDMAP_FONT_FLOOR_PX, 10);
    assert.equal(READABLE_FONT_FLOOR_PX, 12);
  });

  test("isFontSizeReadable: label mode admits >=10, body mode admits >=12", () => {
    assert.equal(isFontSizeReadable(10, { mode: "label" }), true);
    assert.equal(isFontSizeReadable(9.5, { mode: "label" }), false);
    assert.equal(isFontSizeReadable(12, { mode: "body" }), true);
    assert.equal(isFontSizeReadable(11.5, { mode: "body" }), false);
    assert.equal(isFontSizeReadable(NaN, { mode: "label" }), false);
  });
});

describe("placeChainRing", () => {
  test("11 chains evenly distributed, radius preserved", () => {
    const ring = placeChainRing({ count: 11, ringR: 120 });
    assert.equal(ring.length, 11);
    for (const node of ring) {
      const r = Math.hypot(node.x, node.y);
      assert.ok(Math.abs(r - 120) < 1e-9, `radius drift on idx ${node.index}: ${r}`);
    }
  });

  test("adjacent chains at ringR=120 separated > chainSize*2", () => {
    const ring = placeChainRing({ count: 11, ringR: 120 });
    const chainSize = 34;
    for (let i = 0; i < ring.length; i += 1) {
      const next = ring[(i + 1) % ring.length];
      const d = distance(ring[i], next);
      assert.ok(d > chainSize, `adjacent chains ${i}-${(i + 1) % ring.length} too close: ${d}`);
    }
  });

  test("rejects non-positive ringR", () => {
    assert.throws(() => placeChainRing({ count: 5, ringR: 0 }), TypeError);
    assert.throws(() => placeChainRing({ count: 5, ringR: -1 }), TypeError);
  });

  test("count 0 returns empty", () => {
    assert.deepEqual(placeChainRing({ count: 0, ringR: 100 }), []);
  });
});

describe("bloomRadiusForCount + computeProtocolBloom: overlap-free", () => {
  test("single chip uses minR", () => {
    const r = bloomRadiusForCount({ count: 1, chipR: 30, minR: 62 });
    assert.equal(r, 62);
  });

  test("two chips fit at minR", () => {
    const r = bloomRadiusForCount({ count: 2, chipR: 28, minR: 62 });
    assert.ok(r >= 62);
  });

  test("chips never overlap for counts 1..8 with chipR=31, padding=6", () => {
    for (let count = 1; count <= 8; count += 1) {
      const anchor = { x: 80, y: 60 };
      const { radius, points } = computeProtocolBloom({
        anchor, count, chipR: 31, minR: 62, padding: 6,
      });
      assert.ok(radius >= 62, `count=${count} radius below minR`);
      assert.equal(points.length, count);
      for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
          const d = distance(points[i], points[j]);
          assert.ok(
            d >= 2 * 31 + 6 - 1e-6,
            `count=${count} chips ${i},${j} overlap: d=${d.toFixed(2)} < ${2 * 31 + 6}`
          );
        }
      }
    }
  });

  test("anchor on positive y maps spread tangent to chain ring", () => {
    const { points } = computeProtocolBloom({
      anchor: { x: 0, y: 100 }, count: 3, chipR: 28, minR: 62, padding: 6,
    });
    const center = { x: 0, y: 100 };
    const distances = points.map((p) => distance(p, center));
    for (const d of distances) {
      assert.ok(Math.abs(d - distances[0]) < 1e-6, "all chips equidistant from anchor");
    }
  });

  test("rejects non-finite chipR", () => {
    assert.throws(
      () => bloomRadiusForCount({ count: 3, chipR: 0 }),
      TypeError
    );
  });

  test("rejects missing anchor", () => {
    assert.throws(
      () => computeProtocolBloom({ anchor: null, count: 3, chipR: 28 }),
      TypeError
    );
  });
});

describe("fitBoundsInViewBox", () => {
  test("pads bounds symmetrically before fitting", () => {
    const padded = padBounds(
      { minX: -20, minY: -10, maxX: 30, maxY: 40 },
      { x: 6, y: 8 }
    );
    assert.deepEqual(padded, { minX: -26, minY: -18, maxX: 36, maxY: 48 });
  });

  test("keeps protocol focus inside the safe viewport while allowing zoom-in", () => {
    const bounds = padBounds(
      { minX: -58, minY: -102, maxX: 64, maxY: 54 },
      { x: 14, y: 18 }
    );
    const safeArea = { left: 16, right: 16, top: 22, bottom: 172 };
    const result = fitBoundsInViewBox({
      bounds,
      viewBox: { width: 360, height: 520 },
      safeArea,
      focus: { x: 6, y: -8 },
      minZoom: 0.78,
      maxZoom: 1.72,
    });

    assert.ok(result.zoom > 1, `expected focused zoom-in, got ${result.zoom}`);

    const left = bounds.minX * result.zoom + result.tx;
    const right = bounds.maxX * result.zoom + result.tx;
    const top = bounds.minY * result.zoom + result.ty;
    const bottom = bounds.maxY * result.zoom + result.ty;
    assert.ok(left >= safeArea.left - 1e-6, `left overflow: ${left}`);
    assert.ok(right <= 360 - safeArea.right + 1e-6, `right overflow: ${right}`);
    assert.ok(top >= safeArea.top - 1e-6, `top overflow: ${top}`);
    assert.ok(bottom <= 520 - safeArea.bottom + 1e-6, `bottom overflow: ${bottom}`);
  });
});
