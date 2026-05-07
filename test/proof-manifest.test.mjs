import assert from "node:assert/strict";
import { test } from "node:test";

import { buildProofManifest, canonicalJson } from "../src/proof/manifest.mjs";

test("canonicalJson is stable across object key order", () => {
  assert.equal(
    canonicalJson({ b: 2, a: { d: 4, c: 3 } }),
    canonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test("proof manifest hash is stable for equivalent inputs", () => {
  const first = buildProofManifest({
    kind: "payback_disbursement",
    observedAt: "2026-05-07T00:00:00.000Z",
    sourcePointers: [{ kind: "gateway_order", id: "order-1" }],
    artifacts: [{ kind: "destination_proof", sha256: "abc", path: "data/private/proof.json" }],
    redactions: ["wallet_inventory_raw"],
    verdict: { status: "delivered", sats: 1000 },
  });
  const second = buildProofManifest({
    verdict: { sats: 1000, status: "delivered" },
    redactions: ["wallet_inventory_raw"],
    artifacts: [{ path: "data/private/proof.json", sha256: "abc", kind: "destination_proof" }],
    sourcePointers: [{ id: "order-1", kind: "gateway_order" }],
    kind: "payback_disbursement",
    observedAt: "2026-05-07T00:00:00.000Z",
  });

  assert.equal(first.manifestHash, second.manifestHash);
  assert.equal(first.kind, "payback_disbursement");
  assert.equal(first.rawArtifactPublished, false);
});

test("proof manifest rejects secret-like raw fields", () => {
  assert.throws(
    () => buildProofManifest({
      kind: "bad",
      sourcePointers: [],
      artifacts: [{ kind: "raw_tx", signedTx: "0xabc" }],
      verdict: { status: "unsafe" },
    }),
    /proof_manifest_forbidden_field: artifacts.0.signedTx/u,
  );
});
