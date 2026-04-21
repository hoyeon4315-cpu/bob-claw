import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMindmapSlice } from "../src/status/mindmap-slice.mjs";

const BASE_INPUT = Object.freeze({
  chains: [
    { id: "bitcoin", role: "source" },
    { id: "bob", role: "destination" },
    { id: "base", role: "destination" },
    { id: "avalanche", role: "destination" },
  ],
  protocols: [
    {
      id: "moonwell",
      chainId: "base",
      role: "lending",
      balanceSats: 12345,
      apyBps: 610,
      logoId: "moonwell",
    },
    {
      id: "gateway",
      chainId: "bob",
      role: "gateway",
      balanceSats: 0,
      apyBps: 0,
      logoId: "gateway",
    },
  ],
  flows: [
    { kind: "onramp", fromChainId: "bitcoin", toChainId: "base", amountSats: 100000 },
    { kind: "gateway_bridge", fromChainId: "base", toChainId: "bob", amountSats: 50000 },
    { kind: "offramp", fromChainId: "base", toChainId: "bitcoin", amountSats: 20000 },
    { kind: "payback", fromChainId: "base", toChainId: "bitcoin", amountSats: 10000 },
    // Must be dropped — chain-internal swap.
    { kind: "swap", fromChainId: "base", toChainId: "base", amountSats: 999 },
    // Must be dropped — unsupported kind.
    { kind: "transfer", fromChainId: "base", toChainId: "bob", amountSats: 1 },
    // Must be dropped — unknown chain.
    { kind: "gateway_bridge", fromChainId: "mars", toChainId: "bob", amountSats: 1 },
  ],
});

describe("buildMindmapSlice", () => {
  it("keeps only cross-chain Gateway flows", () => {
    const out = buildMindmapSlice(BASE_INPUT);
    assert.equal(out.counts.bridges, 2); // onramp + gateway_bridge
    assert.equal(out.counts.paybacks, 2); // offramp→bitcoin + payback
    assert.equal(out.edges.length, 4);
    for (const e of out.edges) {
      assert.notEqual(e.fromChainId, e.toChainId);
    }
  });

  it("tags offramp-to-bitcoin as payback", () => {
    const out = buildMindmapSlice(BASE_INPUT);
    const offramp = out.edges.find(
      (e) => e.kind === "offramp" && e.toChainId === "bitcoin",
    );
    assert.ok(offramp);
    assert.equal(offramp.type, "payback");
  });

  it("drops chain-internal swaps", () => {
    const out = buildMindmapSlice(BASE_INPUT);
    const sameChain = out.edges.filter((e) => e.fromChainId === e.toChainId);
    assert.equal(sameChain.length, 0);
  });

  it("drops unsupported flow kinds", () => {
    const out = buildMindmapSlice(BASE_INPUT);
    assert.ok(!out.edges.some((e) => e.kind === "transfer"));
    assert.ok(!out.edges.some((e) => e.kind === "swap"));
  });

  it("drops flows referencing unknown chains", () => {
    const out = buildMindmapSlice(BASE_INPUT);
    assert.ok(!out.edges.some((e) => e.fromChainId === "mars" || e.toChainId === "mars"));
  });

  it("emits chain nodes with declared roles", () => {
    const out = buildMindmapSlice(BASE_INPUT);
    const chains = out.nodes.filter((n) => n.type === "chain");
    assert.equal(chains.length, 4);
    assert.equal(chains.find((c) => c.id === "bitcoin").role, "source");
    assert.equal(chains.find((c) => c.id === "base").role, "destination");
  });

  it("emits protocol nodes with logo/role/balance/apy", () => {
    const out = buildMindmapSlice(BASE_INPUT);
    const mw = out.nodes.find((n) => n.type === "protocol" && n.id === "moonwell");
    assert.ok(mw);
    assert.equal(mw.chainId, "base");
    assert.equal(mw.role, "lending");
    assert.equal(mw.balanceSats, 12345);
    assert.equal(mw.apyBps, 610);
    assert.equal(mw.logoId, "moonwell");
  });

  it("treats missing protocol fields as null (pending)", () => {
    const out = buildMindmapSlice({
      chains: [{ id: "base", role: "destination" }],
      protocols: [{ id: "mystery", chainId: "base" }],
      flows: [],
    });
    const m = out.nodes.find((n) => n.type === "protocol" && n.id === "mystery");
    assert.ok(m);
    assert.equal(m.role, null);
    assert.equal(m.balanceSats, null);
    assert.equal(m.apyBps, null);
    assert.equal(m.logoId, null);
  });

  it("drops protocols on unknown chains", () => {
    const out = buildMindmapSlice({
      chains: [{ id: "base", role: "destination" }],
      protocols: [{ id: "ghost", chainId: "nowhere", logoId: "x" }],
      flows: [],
    });
    assert.equal(out.counts.protocols, 0);
  });

  it("deduplicates chains and protocols", () => {
    const out = buildMindmapSlice({
      chains: [
        { id: "base", role: "destination" },
        { id: "base", role: "destination" },
      ],
      protocols: [
        { id: "moonwell", chainId: "base" },
        { id: "moonwell", chainId: "base" },
      ],
      flows: [],
    });
    assert.equal(out.counts.chains, 1);
    assert.equal(out.counts.protocols, 1);
  });

  it("orders edges deterministically (bridges before paybacks)", () => {
    const out = buildMindmapSlice(BASE_INPUT);
    let sawPayback = false;
    for (const e of out.edges) {
      if (e.type === "payback") sawPayback = true;
      else assert.equal(sawPayback, false, "bridge after payback breaks ordering");
    }
  });

  it("produces frozen output (no mutation)", () => {
    const out = buildMindmapSlice(BASE_INPUT);
    assert.throws(() => {
      out.edges.push({});
    });
    assert.throws(() => {
      out.nodes[0].role = "hacked";
    });
    assert.throws(() => {
      out.counts.bridges = 999;
    });
  });

  it("is deterministic over two runs", () => {
    const a = buildMindmapSlice(BASE_INPUT);
    const b = buildMindmapSlice(BASE_INPUT);
    assert.deepEqual(a, b);
  });

  it("handles empty / missing input without throwing", () => {
    const out = buildMindmapSlice({});
    assert.equal(out.counts.chains, 0);
    assert.equal(out.counts.protocols, 0);
    assert.equal(out.counts.bridges, 0);
    assert.equal(out.counts.paybacks, 0);
  });
});
