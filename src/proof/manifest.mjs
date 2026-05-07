import { createHash } from "node:crypto";

const FORBIDDEN_KEY = /privateKey|mnemonic|signedTx|rawTransaction|secret|apiKey|password/iu;

function sortedObject(value) {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedObject(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(sortedObject(value));
}

function assertNoForbiddenKeys(value, path = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}.${index}`.replace(/^\./u, "")));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`.replace(/^\./u, "");
    if (FORBIDDEN_KEY.test(key)) throw new Error(`proof_manifest_forbidden_field: ${childPath}`);
    assertNoForbiddenKeys(child, childPath);
  }
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildProofManifest({
  kind,
  observedAt = new Date().toISOString(),
  sourcePointers = [],
  artifacts = [],
  redactions = [],
  verdict = {},
} = {}) {
  if (!kind) throw new Error("proof_manifest_kind_required");
  const payload = {
    schemaVersion: 1,
    kind,
    observedAt,
    sourcePointers,
    artifacts,
    redactions,
    verdict,
    rawArtifactPublished: false,
  };
  assertNoForbiddenKeys(payload);
  const canonical = canonicalJson(payload);
  return {
    ...payload,
    manifestHash: `sha256:${sha256Hex(canonical)}`,
  };
}
