#!/usr/bin/env node
// Emits dashboard/public/wallet-holdings.json from data/whole-wallet-inventory.jsonl.
// Graceful pending fallback when inventory is missing or empty.
// Deterministic, pure I/O; no keys, no network.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProtocolAprSlice } from '../status/protocol-apr-slice.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '../..');
const INVENTORY_PATH = path.join(ROOT, 'data', 'whole-wallet-inventory.jsonl');
const WRAPPED_BTC_LOOP_SLICE_PATH = path.join(ROOT, 'data', 'wrapped-btc-lending-loop-slice.json');
const RECURSIVE_WRAPPED_BTC_LOOP_SCAFFOLD_PATH = path.join(ROOT, 'data', 'recursive_wrapped_btc_lending_loop-scaffold.json');
const OUTPUT_PATH = path.join(ROOT, 'dashboard', 'public', 'wallet-holdings.json');

async function readLastJsonlLine(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try { return JSON.parse(lines[i]); } catch { /* skip malformed */ }
    }
    return null;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function normaliseChain(id) {
  if (!id) return null;
  const low = String(id).toLowerCase();
  // Align with dashboard CHAINS ids.
  const map = { bnb: 'bsc', avax: 'avalanche', berachain: 'bera' };
  return map[low] || low;
}

function normaliseTicker(t) {
  if (!t) return null;
  const low = String(t).toLowerCase();
  const map = { 'wbtc.oft': 'wbtc', 'cbbtc': 'cbbtc' };
  return map[low] || low;
}

function buildItems(inv) {
  const out = [];
  for (const n of inv.native || []) {
    const usd = Number(n.estimatedUsd);
    const amt = Number(n.actualDecimal);
    if (!Number.isFinite(amt)) continue;
    out.push({
      sym: normaliseTicker(n.ticker),
      name: n.ticker || '',
      chain: normaliseChain(n.chain),
      amount: amt,
      usd: Number.isFinite(usd) ? usd : null,
      family: 'native',
    });
  }
  for (const t of inv.tokenBalances || []) {
    const usd = Number(t.estimatedUsd);
    const amt = Number(t.actualDecimal);
    if (!Number.isFinite(amt) || amt === 0) continue;
    out.push({
      sym: normaliseTicker(t.ticker || t.symbol),
      name: t.ticker || t.symbol || '',
      chain: normaliseChain(t.chain),
      amount: amt,
      usd: Number.isFinite(usd) ? usd : null,
      family: 'token',
    });
  }
  // Sort richest first, then stable tie-break on sym/chain.
  out.sort((a, b) => (b.usd || 0) - (a.usd || 0) || String(a.sym).localeCompare(String(b.sym)));
  return out;
}

async function main() {
  const inv = await readLastJsonlLine(INVENTORY_PATH);
  const [wrappedBtcLoopSlice, recursiveWrappedBtcLoopScaffold] = await Promise.all([
    readJsonIfExists(WRAPPED_BTC_LOOP_SLICE_PATH),
    readJsonIfExists(RECURSIVE_WRAPPED_BTC_LOOP_SCAFFOLD_PATH),
  ]);
  const protocolApr = buildProtocolAprSlice({
    wrappedBtcLoopSlice,
    recursiveWrappedBtcLoopScaffold,
  });
  let payload;
  if (!inv) {
    payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      pending: true,
      reason: 'whole-wallet-inventory.jsonl missing or empty',
      address: null,
      totalUsd: null,
      items: [],
      protocolApr,
    };
  } else {
    const items = buildItems(inv);
    payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      observedAt: inv.observedAt || null,
      pending: items.length === 0,
      address: inv.address || null,
      totalUsd: Number.isFinite(inv.totalUsd) ? inv.totalUsd : null,
      items,
      protocolApr,
    };
  }
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({
    ok: true,
    pending: payload.pending,
    itemCount: payload.items.length,
    totalUsd: payload.totalUsd,
    out: path.relative(ROOT, OUTPUT_PATH),
  }) + '\n');
}

main().catch(err => {
  process.stderr.write(`[report-wallet-holdings-slice] ${err?.stack || err}\n`);
  process.exit(1);
});
