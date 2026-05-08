import { createHash } from "node:crypto";
import { isEthFamilyRoute } from "../assets/tokens.mjs";
import { GatewayClient, routeKey, summarizeRoutes } from "../gateway/client.mjs";
import { buildGatewayQuoteParams } from "../gateway/quote-params.mjs";

const ZERO_TOKEN = "0x0000000000000000000000000000000000000000";
const DEFAULT_BTC_TOKEN = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
export const DEFAULT_GATEWAY_OPENAPI_URL = "https://docs.gobob.xyz/api-reference/openapi.json";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function uniqueSorted(items) {
  return [...new Set(items)].sort();
}

function sortedSetDiff(previousItems = [], currentItems = []) {
  const previous = new Set(previousItems || []);
  const current = new Set(currentItems || []);
  return {
    added: [...current].filter((item) => !previous.has(item)).sort(),
    removed: [...previous].filter((item) => !current.has(item)).sort(),
  };
}

function tokenKey(route) {
  return `${route.srcToken}->${route.dstToken}`;
}

function quoteShape(body) {
  const type = body.onramp ? "onramp" : body.offramp ? "offramp" : body.layerZero ? "layerZero" : "unknown";
  const quote = body.onramp || body.offramp || body.layerZero || body;
  return {
    type,
    topLevelKeys: Object.keys(body).sort(),
    quoteKeys: Object.keys(quote).sort(),
    hasFeeBreakdown: Boolean(quote.feeBreakdown),
    hasTx: Boolean(quote.tx),
    hasSignedQuoteData: Boolean(quote.signedQuoteData),
    hasInputAmount: Boolean(quote.inputAmount),
    hasOutputAmount: Boolean(quote.outputAmount),
    hasEstimatedTime: quote.estimatedTimeInSecs !== undefined,
  };
}

function quoteParamsFor(route, amount, evmRecipient, btcRecipient) {
  return buildGatewayQuoteParams({
    route,
    amount,
    sender: evmRecipient,
    recipient: route.dstChain === "bitcoin" ? btcRecipient : evmRecipient,
    slippage: "50",
  });
}

export function buildRouteSnapshot(routes) {
  const routeKeys = uniqueSorted(routes.map(routeKey));
  const chains = uniqueSorted(routes.flatMap((route) => [route.srcChain, route.dstChain]));
  const tokens = uniqueSorted(routes.flatMap((route) => [route.srcToken, route.dstToken]));
  const chainPairs = uniqueSorted(routes.map((route) => `${route.srcChain}->${route.dstChain}`));
  const tokenPairs = uniqueSorted(routes.map(tokenKey));
  const bobTouchingRouteKeys = routeKeys.filter((key) => key.includes("bob:") || key.includes("->bob:"));
  const ethFamilyRoutes = routes.filter(isEthFamilyRoute);
  const ethFamilyRouteKeys = uniqueSorted(ethFamilyRoutes.map(routeKey));
  const ethFamilyChainPairs = uniqueSorted(ethFamilyRoutes.map((route) => `${route.srcChain}->${route.dstChain}`));

  return {
    routeCount: routes.length,
    ethFamilyRouteCount: ethFamilyRouteKeys.length,
    chains,
    tokens,
    chainPairs,
    tokenPairs,
    routeKeys,
    bobTouchingRouteKeys,
    ethFamilyRouteKeys,
    ethFamilyChainPairs,
    routeHash: sha256(routeKeys.join("\n")),
    chainHash: sha256(chains.join("\n")),
    tokenHash: sha256(tokens.join("\n")),
    summary: summarizeRoutes(routes),
  };
}

export function diffSnapshots(previous, current) {
  if (!previous) {
    return {
      changed: true,
      reason: "initial_snapshot",
      addedRoutes: current.routeKeys,
      removedRoutes: [],
      addedChains: current.chains,
      removedChains: [],
      addedTokens: current.tokens,
      removedTokens: [],
      addedEthFamilyRoutes: current.ethFamilyRouteKeys || [],
      removedEthFamilyRoutes: [],
      addedEthFamilyChainPairs: current.ethFamilyChainPairs || [],
      removedEthFamilyChainPairs: [],
    };
  }

  const { added: addedRoutes, removed: removedRoutes } = sortedSetDiff(previous.routeKeys, current.routeKeys);
  const { added: addedChains, removed: removedChains } = sortedSetDiff(previous.chains, current.chains);
  const { added: addedTokens, removed: removedTokens } = sortedSetDiff(previous.tokens, current.tokens);
  const { added: addedEthFamilyRoutes, removed: removedEthFamilyRoutes } = sortedSetDiff(
    previous.ethFamilyRouteKeys,
    current.ethFamilyRouteKeys,
  );
  const { added: addedEthFamilyChainPairs, removed: removedEthFamilyChainPairs } = sortedSetDiff(
    previous.ethFamilyChainPairs,
    current.ethFamilyChainPairs,
  );

  return {
    changed:
      previous.routeHash !== current.routeHash ||
      previous.chainHash !== current.chainHash ||
      previous.tokenHash !== current.tokenHash,
    reason: "comparison",
    addedRoutes,
    removedRoutes,
    addedChains,
    removedChains,
    addedTokens,
    removedTokens,
    addedEthFamilyRoutes,
    removedEthFamilyRoutes,
    addedEthFamilyChainPairs,
    removedEthFamilyChainPairs,
  };
}

export function diffSchema(previousSchemaHash, currentSchemaHash) {
  if (!previousSchemaHash) {
    return {
      changed: true,
      reason: "initial_schema_snapshot",
      previousSchemaHash: null,
      currentSchemaHash,
    };
  }

  return {
    changed: previousSchemaHash !== currentSchemaHash,
    reason: "comparison",
    previousSchemaHash,
    currentSchemaHash,
  };
}

export function diffSchemaShapes(previousSchemaShapes, currentSchemaShapes, previousSchemaHash, currentSchemaHash) {
  if (!previousSchemaShapes) {
    return diffSchema(previousSchemaHash, currentSchemaHash);
  }

  const previousByRoute = new Map(previousSchemaShapes.map((item) => [item.routeKey, item.shape]));
  const currentByRoute = new Map(currentSchemaShapes.map((item) => [item.routeKey, item.shape]));
  const sharedRouteKeys = [...previousByRoute.keys()].filter((routeKey) => currentByRoute.has(routeKey)).sort();
  const changedRouteKeys = sharedRouteKeys.filter(
    (routeKey) => stableJson(previousByRoute.get(routeKey)) !== stableJson(currentByRoute.get(routeKey)),
  );

  return {
    changed: changedRouteKeys.length > 0,
    reason: "shape_comparison",
    previousSchemaHash,
    currentSchemaHash,
    sharedRouteKeys,
    changedRouteKeys,
  };
}

export function diffProbeHealth(previousProbeHealthHash, currentProbeHealthHash) {
  if (!previousProbeHealthHash) {
    return {
      changed: true,
      reason: "initial_probe_health_snapshot",
      previousProbeHealthHash: null,
      currentProbeHealthHash,
    };
  }

  return {
    changed: previousProbeHealthHash !== currentProbeHealthHash,
    reason: "comparison",
    previousProbeHealthHash,
    currentProbeHealthHash,
  };
}

export function diffOpenApiSnapshot(previousOpenApiSnapshot, currentOpenApiSnapshot) {
  if (!currentOpenApiSnapshot?.sha256) {
    return {
      changed: false,
      reason: "openapi_unavailable",
      previousSha256: previousOpenApiSnapshot?.sha256 || null,
      currentSha256: null,
    };
  }
  if (!previousOpenApiSnapshot?.sha256) {
    return {
      changed: true,
      reason: "initial_openapi_snapshot",
      previousSha256: null,
      currentSha256: currentOpenApiSnapshot.sha256,
    };
  }
  return {
    changed: previousOpenApiSnapshot.sha256 !== currentOpenApiSnapshot.sha256,
    reason: "comparison",
    previousSha256: previousOpenApiSnapshot.sha256,
    currentSha256: currentOpenApiSnapshot.sha256,
  };
}

export async function fetchOpenApiSnapshot({
  openApiUrl = DEFAULT_GATEWAY_OPENAPI_URL,
  fetchImpl = fetch,
} = {}) {
  try {
    const response = await fetchImpl(openApiUrl, {
      headers: { accept: "application/json,text/plain,*/*" },
      signal: AbortSignal.timeout(20_000),
    });
    const bodyText = await response.text();
    return {
      url: openApiUrl,
      fetchedAt: new Date().toISOString(),
      status: response.status,
      ok: response.ok,
      sha256: response.ok ? sha256(bodyText) : null,
      bytes: bodyText.length,
      contentType: response.headers.get("content-type"),
    };
  } catch (error) {
    return {
      url: openApiUrl,
      fetchedAt: new Date().toISOString(),
      status: null,
      ok: false,
      sha256: null,
      bytes: null,
      contentType: null,
      error: {
        name: error.name,
        message: error.message,
      },
    };
  }
}

export function selectProbeRoutes(routes) {
  const desired = [
    { srcChain: "bitcoin", dstChain: "bob", srcToken: ZERO_TOKEN, dstToken: DEFAULT_BTC_TOKEN },
    { srcChain: "bob", dstChain: "bitcoin", srcToken: DEFAULT_BTC_TOKEN, dstToken: ZERO_TOKEN },
    { srcChain: "bob", dstChain: "base", srcToken: DEFAULT_BTC_TOKEN, dstToken: DEFAULT_BTC_TOKEN },
    { srcChain: "base", dstChain: "bob", srcToken: DEFAULT_BTC_TOKEN, dstToken: DEFAULT_BTC_TOKEN },
  ];

  return desired
    .map((target) =>
      routes.find(
        (route) =>
          route.srcChain === target.srcChain &&
          route.dstChain === target.dstChain &&
          route.srcToken.toLowerCase() === target.srcToken.toLowerCase() &&
          route.dstToken.toLowerCase() === target.dstToken.toLowerCase(),
      ),
    )
    .filter(Boolean);
}

export async function runGatewayUpdateWatch({
  gatewayApiBase,
  previousSnapshot,
  previousSchemaHash,
  previousSchemaShapes,
  previousProbeHealthHash,
  previousOpenApiSnapshot,
  openApiUrl = DEFAULT_GATEWAY_OPENAPI_URL,
  fetchImpl = fetch,
  evmRecipient,
  btcRecipient,
  amount = "10000",
}) {
  const client = new GatewayClient({ baseUrl: gatewayApiBase });
  const routesResult = await client.getRoutes();
  const routes = routesResult.body;
  const snapshot = buildRouteSnapshot(routes);
  const diff = diffSnapshots(previousSnapshot, snapshot);
  const probes = [];

  for (const route of selectProbeRoutes(routes)) {
    try {
      const quoteResult = await client.getQuote(quoteParamsFor(route, amount, evmRecipient, btcRecipient));
      probes.push({
        ok: true,
        route,
        routeKey: routeKey(route),
        latencyMs: quoteResult.latencyMs,
        shape: quoteShape(quoteResult.body),
      });
    } catch (error) {
      probes.push({
        ok: false,
        route,
        routeKey: routeKey(route),
        error: {
          name: error.name,
          message: error.message,
          details: error.details || null,
        },
      });
    }
  }

  const schemaShapes = probes
    .filter((probe) => probe.ok)
    .map((probe) => ({
      routeKey: probe.routeKey,
      shape: probe.shape,
    }))
    .sort((left, right) => left.routeKey.localeCompare(right.routeKey));
  const probeHealth = probes
    .map((probe) => ({
      routeKey: probe.routeKey,
      ok: probe.ok,
      errorName: probe.error?.name || null,
      errorStatus: probe.error?.details?.status || null,
      errorCode: probe.error?.details?.body?.code || null,
    }))
    .sort((left, right) => left.routeKey.localeCompare(right.routeKey));
  const probeFailures = probes
    .filter((probe) => !probe.ok)
    .map((probe) => ({
      routeKey: probe.routeKey,
      errorName: probe.error?.name || null,
      errorStatus: probe.error?.details?.status || null,
      errorCode: probe.error?.details?.body?.code || null,
      errorMessage: probe.error?.details?.body?.error || probe.error?.message || null,
    }));
  const schemaHash = sha256(
    schemaShapes
      .map((item) => JSON.stringify(item))
      .join("\n"),
  );
  const probeHealthHash = sha256(
    probeHealth
      .map((item) => JSON.stringify(item))
      .join("\n"),
  );
  const schemaDiff = diffSchemaShapes(previousSchemaShapes, schemaShapes, previousSchemaHash, schemaHash);
  const probeHealthDiff = diffProbeHealth(previousProbeHealthHash, probeHealthHash);
  const openApiSnapshot = await fetchOpenApiSnapshot({ openApiUrl, fetchImpl });
  const openApiDiff = diffOpenApiSnapshot(previousOpenApiSnapshot, openApiSnapshot);
  const ethFamilySurfaceChanged = diff.addedEthFamilyRoutes.length > 0 || diff.removedEthFamilyRoutes.length > 0;
  const changeReasons = [
    diff.changed ? "route_inventory" : null,
    ethFamilySurfaceChanged ? "eth_family_surface" : null,
    schemaDiff.changed ? "quote_schema" : null,
    probeHealthDiff.changed ? "probe_health" : null,
    openApiDiff.changed ? "gateway_openapi_changed" : null,
  ].filter(Boolean);

  return {
    observedAt: new Date().toISOString(),
    snapshot,
    diff,
    schemaDiff,
    probeHealthDiff,
    openApiDiff,
    openApiSnapshot,
    changeReasons,
    probes,
    schemaShapes,
    probeHealth,
    probeFailures,
    schemaHash,
    probeHealthHash,
    routesLatencyMs: routesResult.latencyMs,
    ethFamily: {
      routeCount: snapshot.ethFamilyRouteCount || 0,
      chainPairs: snapshot.ethFamilyChainPairs || [],
      surfaceChanged: ethFamilySurfaceChanged,
      addedRoutes: diff.addedEthFamilyRoutes,
      removedRoutes: diff.removedEthFamilyRoutes,
      addedChainPairs: diff.addedEthFamilyChainPairs,
      removedChainPairs: diff.removedEthFamilyChainPairs,
    },
    updateDetected: changeReasons.length > 0,
  };
}
