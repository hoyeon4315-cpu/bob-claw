import { getTokensForChain } from "../config/token-registry.mjs";
import { ZERO_TOKEN, normalizeToken, tokenAsset } from "../assets/tokens.mjs";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/u;

function normalizeChain(chain) {
  const value = String(chain || "").trim().toLowerCase();
  if (value === "berachain") return "bera";
  return value;
}

function isEvmAddress(value) {
  return EVM_ADDRESS_RE.test(String(value || ""));
}

function isZeroTokenAddress(value) {
  return normalizeToken(value) === normalizeToken(ZERO_TOKEN);
}

function targetKey(chain, token) {
  const normalizedChain = normalizeChain(chain);
  const normalizedToken = normalizeToken(token);
  return normalizedChain && normalizedToken ? `${normalizedChain}:${normalizedToken}` : null;
}

function registryMap(chains = []) {
  const map = new Map();
  for (const chain of chains || []) {
    const normalizedChain = normalizeChain(chain);
    for (const token of getTokensForChain(normalizedChain)) {
      if (!isEvmAddress(token.address)) continue;
      map.set(targetKey(normalizedChain, token.address), {
        chain: normalizedChain,
        token: token.address,
        symbol: token.symbol || null,
        decimals: Number.isInteger(token.decimals) ? token.decimals : null,
      });
    }
  }
  return map;
}

function sourceRef(kind, record = {}, extra = {}) {
  return {
    kind,
    observedAt: record.observedAt || record.timestamp || null,
    txHash: record.txHash || record.broadcast?.txHash || record.lifecycle?.txHash || null,
    strategyId: record.strategyId || null,
    intentId: record.intentId || null,
    positionId: record.positionId || null,
    eventId: record.eventId || null,
    field: extra.field || null,
  };
}

function routeKeyParts(routeKey = "") {
  const match = String(routeKey || "").match(
    /^(?<srcChain>[^:]+):(?<srcToken>0x[a-fA-F0-9]{40})->(?<dstChain>[^:]+):(?<dstToken>0x[a-fA-F0-9]{40})$/u,
  );
  if (!match?.groups) return [];
  return [
    {
      chain: match.groups.srcChain,
      token: match.groups.srcToken,
      field: "routeContext.routeKey.srcToken",
    },
    {
      chain: match.groups.dstChain,
      token: match.groups.dstToken,
      field: "routeContext.routeKey.dstToken",
    },
  ];
}

function pushToken(candidates, { chain, token, source, record, field, metadata = {} }) {
  const normalizedChain = normalizeChain(chain);
  const normalizedToken = normalizeToken(token);
  if (!normalizedChain || !isEvmAddress(normalizedToken) || isZeroTokenAddress(normalizedToken)) return;
  candidates.push({
    chain: normalizedChain,
    token: normalizedToken,
    metadata,
    source: sourceRef(source, record, { field }),
  });
}

function addReceiptCandidates(candidates, record = {}) {
  const routeContext = record.routeContext || {};
  for (const part of routeKeyParts(routeContext.routeKey)) {
    pushToken(candidates, {
      chain: part.chain,
      token: part.token,
      source: "receipt_reconciliation",
      record,
      field: part.field,
    });
  }
  pushToken(candidates, {
    chain: routeContext.srcChain || record.chain,
    token: routeContext.srcToken,
    source: "receipt_reconciliation",
    record,
    field: "routeContext.srcToken",
  });
  pushToken(candidates, {
    chain: routeContext.dstChain || record.chain,
    token: routeContext.dstToken,
    source: "receipt_reconciliation",
    record,
    field: "routeContext.dstToken",
  });
  const outputAsset = record.output?.asset || {};
  pushToken(candidates, {
    chain: outputAsset.chain || routeContext.dstChain || record.chain,
    token: outputAsset.token,
    source: "receipt_reconciliation",
    record,
    field: "output.asset.token",
    metadata: {
      symbol: outputAsset.ticker || outputAsset.symbol || null,
      decimals: Number.isInteger(outputAsset.decimals) ? outputAsset.decimals : null,
      family: outputAsset.family || null,
      priceKey: outputAsset.priceKey || null,
    },
  });
}

function addSignerAuditCandidates(candidates, record = {}) {
  const chain = record.chain;
  const metadata = record.intent?.metadata || {};
  for (const field of ["inputToken", "outputToken", "assetAddress", "shareTokenAddress"]) {
    pushToken(candidates, {
      chain,
      token: metadata[field],
      source: "signer_audit_intent",
      record,
      field: `intent.metadata.${field}`,
    });
  }
  if (metadata.expectedTxTo && String(record.intent?.intentType || "").includes("erc4626")) {
    pushToken(candidates, {
      chain,
      token: metadata.expectedTxTo,
      source: "signer_audit_intent",
      record,
      field: "intent.metadata.expectedTxTo",
    });
  }
}

function addInboundCandidates(candidates, record = {}) {
  pushToken(candidates, {
    chain: record.chain,
    token: record.token,
    source: "treasury_inbound_event",
    record,
    field: "token",
    metadata: {
      symbol: record.ticker || null,
      decimals: Number.isInteger(record.decimals) ? record.decimals : null,
    },
  });
}

function addProtocolMarkCandidates(candidates, record = {}) {
  const baseMeta = {
    protocolId: record.protocolId || null,
    strategyId: record.strategyId || null,
    positionId: record.positionId || null,
  };
  pushToken(candidates, {
    chain: record.chain,
    token: record.assetAddress || record.underlyingTokenAddress,
    source: "protocol_position_mark",
    record,
    field: "assetAddress",
    metadata: {
      ...baseMeta,
      symbol: record.assetSymbol || record.symbol || null,
      decimals: Number.isInteger(record.assetDecimals) ? record.assetDecimals : null,
      role: "underlying",
      coveredByFreshReader: record.event === "position_marked" && record.confidence === "verified_current",
    },
  });
  pushToken(candidates, {
    chain: record.chain,
    token: record.shareTokenAddress,
    source: "protocol_position_mark",
    record,
    field: "shareTokenAddress",
    metadata: {
      ...baseMeta,
      symbol: record.assetSymbol || record.symbol || null,
      decimals: Number.isInteger(record.assetDecimals) ? record.assetDecimals : null,
      role: "share",
      coveredByFreshReader: record.event === "position_marked" && record.confidence === "verified_current",
    },
  });
}

function mergeMetadata(left = {}, right = {}) {
  return {
    ...left,
    ...Object.fromEntries(Object.entries(right).filter(([, value]) => value !== null && value !== undefined)),
  };
}

function registerCandidates(candidates = [], { chains = [] } = {}) {
  const registry = registryMap(chains);
  const byKey = new Map();
  for (const candidate of candidates) {
    const key = targetKey(candidate.chain, candidate.token);
    if (!key) continue;
    const existing = byKey.get(key) || {
      chain: normalizeChain(candidate.chain),
      token: normalizeToken(candidate.token),
      sourceRefs: [],
      metadata: {},
    };
    existing.sourceRefs.push(candidate.source);
    existing.metadata = mergeMetadata(existing.metadata, candidate.metadata);
    byKey.set(key, existing);
  }

  for (const [key, registered] of registry) {
    const existing = byKey.get(key) || {
      chain: registered.chain,
      token: normalizeToken(registered.token),
      sourceRefs: [],
      metadata: {},
    };
    existing.sourceRefs.push({ kind: "committed_token_registry", observedAt: null, field: null });
    existing.metadata = mergeMetadata(existing.metadata, {
      symbol: registered.symbol,
      decimals: registered.decimals,
    });
    byKey.set(key, existing);
  }

  return [...byKey.values()].map((target) => {
    const registered = registry.get(targetKey(target.chain, target.token)) || null;
    const asset = tokenAsset(target.chain, target.token, {
      ticker: target.metadata.symbol || registered?.symbol || undefined,
      decimals: Number.isInteger(target.metadata.decimals) ? target.metadata.decimals : registered?.decimals,
    });
    const sourceKinds = [...new Set(target.sourceRefs.map((item) => item.kind).filter(Boolean))].sort();
    const coveredByFreshProtocolReader = target.metadata.coveredByFreshReader === true;
    const isRegistered = Boolean(registered);
    return {
      chain: target.chain,
      token: target.token,
      symbol: target.metadata.symbol || registered?.symbol || asset.ticker || null,
      decimals: Number.isInteger(target.metadata.decimals)
        ? target.metadata.decimals
        : Number.isInteger(registered?.decimals)
          ? registered.decimals
          : asset.decimals,
      family: target.metadata.family || asset.family || "unknown",
      priceKey: target.metadata.priceKey || asset.priceKey || null,
      registered: isRegistered,
      coveredByFreshProtocolReader,
      sourceKinds,
      sourceRefs: target.sourceRefs.slice(0, 8),
      trackingStatus: isRegistered
        ? "registered"
        : coveredByFreshProtocolReader
          ? "protocol_reader_covered"
          : "pending_whitelist_review",
    };
  }).sort((left, right) => `${left.chain}:${left.token}`.localeCompare(`${right.chain}:${right.token}`));
}

export function buildAssetUniverse({
  chains = [],
  receiptReconciliations = [],
  signerAuditRecords = [],
  inboundEvents = [],
  protocolPositionMarks = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const candidates = [];
  for (const record of receiptReconciliations || []) addReceiptCandidates(candidates, record);
  for (const record of signerAuditRecords || []) addSignerAuditCandidates(candidates, record);
  for (const record of inboundEvents || []) addInboundCandidates(candidates, record);
  for (const record of protocolPositionMarks || []) addProtocolMarkCandidates(candidates, record);
  const targets = registerCandidates(candidates, { chains });
  const unknownTargets = targets.filter((target) => target.trackingStatus === "pending_whitelist_review");
  return {
    schemaVersion: 1,
    generatedAt,
    targetCount: targets.length,
    registeredTargetCount: targets.filter((target) => target.registered).length,
    protocolReaderCoveredTargetCount: targets.filter((target) => target.trackingStatus === "protocol_reader_covered").length,
    unknownTargetCount: unknownTargets.length,
    status: unknownTargets.length === 0 ? "closed" : "needs_review",
    targets,
    unknownTargets,
  };
}

export function assetUniverseTokenTargets(assetUniverse = null) {
  return (assetUniverse?.targets || [])
    .filter((target) => target.chain && target.token && isEvmAddress(target.token))
    .map((target) => ({
      chain: normalizeChain(target.chain),
      token: target.token,
      ticker: target.symbol || null,
      family: target.family || null,
      decimals: Number.isInteger(target.decimals) ? target.decimals : null,
      priceKey: target.priceKey || null,
      registered: target.registered === true,
      trackingStatus: target.trackingStatus || null,
      sourceKinds: target.sourceKinds || [],
    }));
}
