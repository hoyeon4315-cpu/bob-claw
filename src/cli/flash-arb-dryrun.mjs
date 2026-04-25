#!/usr/bin/env node

import { odosSafeSourceWhitelist } from "../dex/odos.mjs";
import { getTriangleProfile, trianglePermutations } from "../flash/triangle-profiles.mjs";

const DEFAULT_USD_PRICES = Object.freeze({
  btc: 70000,
  eth: 2500,
});

async function getJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    const wrapped = new Error("Request returned non-JSON response");
    wrapped.details = { url, status: response.status, bodySnippet: text.slice(0, 500) };
    wrapped.cause = error;
    throw wrapped;
  }
  if (!response.ok) {
    const error = new Error(body?.detail || body?.message || `Request failed with ${response.status}`);
    error.details = { url, status: response.status, body };
    throw error;
  }
  return body;
}

function parseArgs(argv) {
  const args = { amount: 0.005, minProfitPct: 0.2, triangular: false, profile: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--amount") args.amount = Number(argv[++i]);
    else if (value.startsWith("--amount=")) args.amount = Number(value.slice(9));
    else if (value === "--pair") args.pair = argv[++i];
    else if (value.startsWith("--pair=")) args.pair = value.slice(7);
    else if (value === "--min-profit-pct") args.minProfitPct = Number(argv[++i]);
    else if (value.startsWith("--min-profit-pct=")) args.minProfitPct = Number(value.slice(17));
    else if (value === "--triangular") args.triangular = true;
    else if (value === "--profile") args.profile = argv[++i];
    else if (value.startsWith("--profile=")) args.profile = value.slice(10);
  }
  return args;
}

async function odosQuote(chainId, fromToken, toToken, amountRaw) {
  const body = {
    chainId,
    inputTokens: [{ tokenAddress: fromToken.address, amount: String(amountRaw) }],
    outputTokens: [{ tokenAddress: toToken.address, proportion: 1 }],
    userAddr: "0x000000000000000000000000000000000000dEaD",
    slippageLimitPercent: 0.3,
    disableRFQs: true,
    compact: true,
  };
  const sourceWhitelist = chainId === 8453 ? odosSafeSourceWhitelist("base") : null;
  if (sourceWhitelist) body.sourceWhitelist = sourceWhitelist;
  return getJson("https://api.odos.xyz/sor/quote/v3", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function fetchSpotUsd(symbol) {
  const { price } = await getJson(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`);
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    throw new Error(`Invalid ${symbol} spot price`);
  }
  return numericPrice;
}

async function getReferencePrices() {
  try {
    const [btcUsd, ethUsd] = await Promise.all([fetchSpotUsd("BTC"), fetchSpotUsd("ETH")]);
    return { btc: btcUsd, eth: ethUsd };
  } catch {
    return { ...DEFAULT_USD_PRICES };
  }
}

function toRaw(amount, decimals) {
  const factor = 10 ** decimals;
  return String(Math.round(amount * factor));
}

function fromRaw(raw, decimals) {
  return Number(raw) / 10 ** decimals;
}

function priceKeyForToken(token) {
  return token.assetClass === "eth" ? "eth" : "btc";
}

function tokenPriceUsd(token, prices) {
  const key = priceKeyForToken(token);
  return prices[key] ?? DEFAULT_USD_PRICES[key];
}

function requireQuoteOutput(quote, label) {
  if (!quote || !Array.isArray(quote.outAmounts) || quote.outAmounts.length === 0 || !quote.outAmounts[0]) {
    throw new Error(`No quote output for ${label}`);
  }
  return quote.outAmounts[0];
}

async function runPairArb(profile, fromToken, toToken, amount, minProfitPct, prices) {
  const q1 = await odosQuote(profile.chainId, fromToken, toToken, toRaw(amount, fromToken.decimals));
  const firstQuoteRaw = requireQuoteOutput(q1, `${profile.id}:${fromToken.symbol}→${toToken.symbol}`);
  const intermediateAmount = fromRaw(firstQuoteRaw, toToken.decimals);
  const q2 = await odosQuote(profile.chainId, toToken, fromToken, firstQuoteRaw);
  const secondQuoteRaw = requireQuoteOutput(q2, `${profile.id}:${toToken.symbol}→${fromToken.symbol}`);
  const returnedAmount = fromRaw(secondQuoteRaw, fromToken.decimals);

  const startUsd = amount * tokenPriceUsd(fromToken, prices);
  const grossProfitToken = returnedAmount - amount;
  const grossProfitUsd = grossProfitToken * tokenPriceUsd(fromToken, prices);
  const flashFeeUsd = startUsd * 0.0005;
  const gasUsd = Number(q1.gasEstimateValue || 0) + Number(q2.gasEstimateValue || 0);
  const netUsd = grossProfitUsd - flashFeeUsd - gasUsd;
  const profitPct = (netUsd / startUsd) * 100;

  return {
    type: "direct-pair",
    route: `${fromToken.symbol}→${toToken.symbol}→${fromToken.symbol}`,
    startAmount: amount,
    startSymbol: fromToken.symbol,
    intermediateAmount,
    intermediateSymbol: toToken.symbol,
    returnedAmount,
    grossProfitToken,
    grossProfitUsd,
    flashFeeUsd,
    gasUsd,
    netUsd,
    profitPct,
    passes: profitPct >= minProfitPct,
  };
}

async function runTriangularArb(profile, tokenA, tokenB, usdcAmount, minProfitPct) {
  const stable = profile.stableToken;
  const q1 = await odosQuote(profile.chainId, stable, tokenA, toRaw(usdcAmount, stable.decimals));
  const firstQuoteRaw = requireQuoteOutput(q1, `${profile.id}:${stable.symbol}→${tokenA.symbol}`);
  const tokenAAmount = fromRaw(firstQuoteRaw, tokenA.decimals);
  const q2 = await odosQuote(profile.chainId, tokenA, tokenB, firstQuoteRaw);
  const secondQuoteRaw = requireQuoteOutput(q2, `${profile.id}:${tokenA.symbol}→${tokenB.symbol}`);
  const tokenBAmount = fromRaw(secondQuoteRaw, tokenB.decimals);
  const q3 = await odosQuote(profile.chainId, tokenB, stable, secondQuoteRaw);
  const thirdQuoteRaw = requireQuoteOutput(q3, `${profile.id}:${tokenB.symbol}→${stable.symbol}`);
  const usdcBack = fromRaw(thirdQuoteRaw, stable.decimals);

  const grossUsd = usdcBack - usdcAmount;
  const flashFeeUsd = usdcAmount * 0.0005;
  const gasUsd = Number(q1.gasEstimateValue || 0) + Number(q2.gasEstimateValue || 0) + Number(q3.gasEstimateValue || 0);
  const netUsd = grossUsd - flashFeeUsd - gasUsd;
  const profitPct = (netUsd / usdcAmount) * 100;

  return {
    type: "triangular",
    route: `${stable.symbol}→${tokenA.symbol}→${tokenB.symbol}→${stable.symbol}`,
    startUsd: usdcAmount,
    tokenAAmount,
    tokenA: tokenA.symbol,
    tokenBAmount,
    tokenB: tokenB.symbol,
    usdcBack,
    grossUsd,
    flashFeeUsd,
    gasUsd,
    netUsd,
    profitPct,
    passes: profitPct >= minProfitPct,
  };
}

function uniquePairs(profile) {
  const pairs = [];
  for (let i = 0; i < profile.routeTokens.length; i += 1) {
    for (let j = i + 1; j < profile.routeTokens.length; j += 1) {
      pairs.push([profile.routeTokens[i], profile.routeTokens[j]]);
    }
  }
  return pairs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = getTriangleProfile(args.profile);
  const prices = await getReferencePrices();
  const results = [];

  console.log(
    `Profile=${profile.label} chain=${profile.chainId} assets=${profile.routeTokens.map((token) => token.symbol).join(", ")} ` +
      `directAmount=${args.amount} minProfitPct=${args.minProfitPct}`,
  );
  console.log("");

  if (args.pair) {
    const [leftSymbol, rightSymbol] = args.pair.split("-").map((item) => item.trim());
    const leftToken = profile.routeTokens.find((token) => token.symbol === leftSymbol);
    const rightToken = profile.routeTokens.find((token) => token.symbol === rightSymbol);
    if (!leftToken || !rightToken) {
      console.error(`Unknown pair ${args.pair} for profile ${profile.id}`);
      process.exit(1);
    }
    results.push(await runPairArb(profile, leftToken, rightToken, args.amount, args.minProfitPct, prices));
    results.push(await runPairArb(profile, rightToken, leftToken, args.amount, args.minProfitPct, prices));
  } else if (!args.triangular) {
    for (const [leftToken, rightToken] of uniquePairs(profile)) {
      results.push(await runPairArb(profile, leftToken, rightToken, args.amount, args.minProfitPct, prices));
      results.push(await runPairArb(profile, rightToken, leftToken, args.amount, args.minProfitPct, prices));
    }
  }

  if (args.triangular || !args.pair) {
    for (const [tokenA, tokenB] of trianglePermutations(profile.id)) {
      results.push(await runTriangularArb(profile, tokenA, tokenB, 250, args.minProfitPct));
    }
  }

  for (const result of results.sort((left, right) => right.netUsd - left.netUsd)) {
    const parts = [
      result.passes ? "PASS" : "FAIL",
      result.route,
      `netUsd=${result.netUsd.toFixed(2)}`,
      `profitPct=${result.profitPct.toFixed(3)}%`,
      `gasUsd=${result.gasUsd.toFixed(2)}`,
      `flashFeeUsd=${result.flashFeeUsd.toFixed(2)}`,
    ];
    if (result.type === "direct-pair") {
      parts.push(`${result.startSymbol}=${result.startAmount}→${result.returnedAmount.toFixed(8)}`);
    } else {
      parts.push(`usdcBack=${result.usdcBack.toFixed(2)}`);
    }
    console.log(parts.join(" | "));
  }

  const passing = results.filter((item) => item.passes);
  console.log("");
  console.log(`Passing routes: ${passing.length}/${results.length}`);
  if (passing.length > 0) {
    console.log(`Best route: ${passing[0].route} (${passing[0].netUsd.toFixed(2)} USD)`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
