// T23 — dashboard-status mindmap slice.
//
// Pure function over a subset of dashboard-status input. Produces the minimal
// { nodes, edges } graph the mobile mindmap UI (T24) renders. Determinism
// invariant: same input → same frozen output.
//
// Rules (Plan §T23):
//   1. Chain-internal swaps are EXCLUDED — mindmap shows asset movement
//      across chains only, never same-chain rotations.
//   2. Only Gateway-routed flows (onramp / offramp / gateway_bridge / payback)
//      become edges. Direct 3rd-party bridges are dropped unless flagged
//      kind='gateway_bridge' (operator-declared via audit ingest).
//   3. Payback arrow: any flow ending at chain 'bitcoin', OR kind='payback',
//      is tagged edge.type='payback' so the UI can highlight it.
//   4. Protocol nodes carry logoId / role / balanceSats / apyBps. Missing
//      fields are emitted as null — the UI treats null as "pending".

const ALLOWED_FLOW_KINDS = Object.freeze([
  "gateway_bridge",
  "onramp",
  "offramp",
  "payback",
]);

const ALLOWED_PROTOCOL_ROLES = Object.freeze([
  "lending",
  "dex",
  "bridge",
  "yield",
  "reserve",
  "gateway",
]);

function finiteNumOrNull(v) {
  return Number.isFinite(v) ? v : null;
}

function normChainId(id) {
  return typeof id === "string" && id.length > 0 ? id : null;
}

function buildChainNodes(chains) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(chains) ? chains : []) {
    const id = normChainId(c?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(
      Object.freeze({
        type: "chain",
        id,
        role: c?.role === "source" ? "source" : "destination",
      }),
    );
  }
  return out;
}

function buildProtocolNodes(protocols, knownChainIds) {
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(protocols) ? protocols : []) {
    const id = typeof p?.id === "string" ? p.id : null;
    const chainId = normChainId(p?.chainId);
    if (!id || !chainId || !knownChainIds.has(chainId)) continue;
    const key = `${chainId}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const role = ALLOWED_PROTOCOL_ROLES.includes(p?.role) ? p.role : null;
    out.push(
      Object.freeze({
        type: "protocol",
        id,
        chainId,
        role,
        balanceSats: finiteNumOrNull(Number(p?.balanceSats)),
        apyBps: finiteNumOrNull(Number(p?.apyBps)),
        logoId: typeof p?.logoId === "string" ? p.logoId : null,
      }),
    );
  }
  return out;
}

function buildEdges(flows, knownChainIds) {
  const out = [];
  for (const f of Array.isArray(flows) ? flows : []) {
    const kind = f?.kind;
    if (!ALLOWED_FLOW_KINDS.includes(kind)) continue;
    const from = normChainId(f?.fromChainId);
    const to = normChainId(f?.toChainId);
    if (!from || !to) continue;
    if (!knownChainIds.has(from) || !knownChainIds.has(to)) continue;
    // Rule 1: drop chain-internal flows outright.
    if (from === to) continue;
    const amountSats = finiteNumOrNull(Number(f?.amountSats));
    const isPayback = kind === "payback" || to === "bitcoin";
    out.push(
      Object.freeze({
        type: isPayback ? "payback" : "bridge",
        kind,
        fromChainId: from,
        toChainId: to,
        amountSats,
      }),
    );
  }
  // Deterministic ordering: payback last, then stable by from→to→kind.
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === "payback" ? 1 : -1;
    if (a.fromChainId !== b.fromChainId) {
      return a.fromChainId < b.fromChainId ? -1 : 1;
    }
    if (a.toChainId !== b.toChainId) {
      return a.toChainId < b.toChainId ? -1 : 1;
    }
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return 0;
  });
  return out;
}

export function buildMindmapSlice(input = {}) {
  const chainNodes = buildChainNodes(input.chains);
  const knownChainIds = new Set(chainNodes.map((c) => c.id));
  const protoNodes = buildProtocolNodes(input.protocols, knownChainIds);
  const edges = buildEdges(input.flows, knownChainIds);

  const nodes = Object.freeze([
    ...chainNodes,
    ...protoNodes,
  ]);
  const frozenEdges = Object.freeze(edges);

  return Object.freeze({
    nodes,
    edges: frozenEdges,
    counts: Object.freeze({
      chains: chainNodes.length,
      protocols: protoNodes.length,
      bridges: edges.filter((e) => e.type === "bridge").length,
      paybacks: edges.filter((e) => e.type === "payback").length,
    }),
  });
}

export const __testing = Object.freeze({
  ALLOWED_FLOW_KINDS,
  ALLOWED_PROTOCOL_ROLES,
});
