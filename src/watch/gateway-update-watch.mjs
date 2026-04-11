import { createHash } from "node:crypto";
import { GatewayClient, routeKey, summarizeRoutes } from "../gateway/client.mjs";

const ZERO_TOKEN = "0x0000000000000000000000000000000000000000";
const DEFAULT_BTC_TOKEN = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

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
  const params = {
    srcChain: route.srcChain,
    dstChain: route.dstChain,
    srcToken: route.srcToken,
    dstToken: route.dstToken,
    amount,
    recipient: route.dstChain === "bitcoin" ? btcRecipient : evmRecipient,
    slippage: "50",
  };

  if (route.srcChain !== "bitcoin") {
    params.sender = evmRecipient;
  }

  return params;
}

export function buildRouteSnapshot(routes) {
  const routeKeys = uniqueSorted(routes.map(routeKey));
  const chains = uniqueSorted(routes.flatMap((route) => [route.srcChain, route.dstChain]));
  const tokens = uniqueSorted(routes.flatMap((route) => [route.srcToken, route.dstToken]));
  const chainPairs = uniqueSorted(routes.map((route) => `${route.srcChain}->${route.dstChain}`));
  const tokenPairs = uniqueSorted(routes.map(tokenKey));
  const bobTouchingRouteKeys = routeKeys.filter((key) => key.includes("bob:") || key.includes("->bob:"));

  return {
    routeCount: routes.length,
    chains,
    tokens,
    chainPairs,
    tokenPairs,
    routeKeys,
    bobTouchingRouteKeys,
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
    };
  }

  const prevRoutes = new Set(previous.routeKeys || []);
  const currRoutes = new Set(current.routeKeys || []);
  const prevChains = new Set(previous.chains || []);
  const currChains = new Set(current.chains || []);
  const prevTokens = new Set(previous.tokens || []);
  const currTokens = new Set(current.tokens || []);
  const addedRoutes = [...currRoutes].filter((item) => !prevRoutes.has(item)).sort();
  const removedRoutes = [...prevRoutes].filter((item) => !currRoutes.has(item)).sort();
  const addedChains = [...currChains].filter((item) => !prevChains.has(item)).sort();
  const removedChains = [...prevChains].filter((item) => !currChains.has(item)).sort();
  const addedTokens = [...currTokens].filter((item) => !prevTokens.has(item)).sort();
  const removedTokens = [...prevTokens].filter((item) => !currTokens.has(item)).sort();

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
  const changeReasons = [
    diff.changed ? "route_inventory" : null,
    schemaDiff.changed ? "quote_schema" : null,
    probeHealthDiff.changed ? "probe_health" : null,
  ].filter(Boolean);

  return {
    observedAt: new Date().toISOString(),
    snapshot,
    diff,
    schemaDiff,
    probeHealthDiff,
    changeReasons,
    probes,
    schemaShapes,
    probeHealth,
    probeFailures,
    schemaHash,
    probeHealthHash,
    routesLatencyMs: routesResult.latencyMs,
    updateDetected: changeReasons.length > 0,
  };
}
