/**
 * Aggressive Velocity Sleeve — Data Artifact Writers (Phase 6)
 *
 * Thin I/O layer on top of the pure accounting library.
 * Responsible only for:
 *   - Ensuring `data/aggressive-yield/` exists
 *   - Append-only ledger.jsonl
 *   - Snapshot writers for tracker state, performance, payback attribution
 *
 * All financial logic stays in `aggressive-sleeve-accounting.mjs`.
 * Never mutates core BOB Claw files (loose coupling per plan).
 */

import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DATA_DIR = 'data/aggressive-yield';
const LEDGER_FILE = join(DATA_DIR, 'ledger.jsonl');
const TRACKER_FILE = join(DATA_DIR, 'asset-tracker-state.json');
const PERFORMANCE_FILE = join(DATA_DIR, 'performance.json');
const PAYBACK_ATTRIBUTION_FILE = join(DATA_DIR, 'sleeve-payback-attribution.json');

async function ensureDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

/**
 * Append a validated sleeve ledger event (append-only, schemaVersioned).
 * The event must already have passed validateAndAppendLedgerEvent.
 */
export async function appendLedgerEvent(event) {
  await ensureDir();
  const line = JSON.stringify(event) + '\n';
  await appendFile(LEDGER_FILE, line, 'utf8');
  return { ok: true, path: LEDGER_FILE };
}

/**
 * Write current asset tracker state snapshot (overwrites previous).
 */
export async function writeAssetTrackerState(state) {
  await ensureDir();
  await writeFile(TRACKER_FILE, JSON.stringify(state, null, 2), 'utf8');
  return { ok: true, path: TRACKER_FILE };
}

/**
 * Write performance snapshot (overwrites previous).
 */
export async function writePerformanceSnapshot(snapshot) {
  await ensureDir();
  await writeFile(PERFORMANCE_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
  return { ok: true, path: PERFORMANCE_FILE };
}

/**
 * Write sleeve payback attribution (additive input for future payback extensions).
 */
export async function writePaybackAttribution(attribution) {
  await ensureDir();
  await writeFile(PAYBACK_ATTRIBUTION_FILE, JSON.stringify(attribution, null, 2), 'utf8');
  return { ok: true, path: PAYBACK_ATTRIBUTION_FILE };
}

export const AGGRESSIVE_YIELD_DATA_DIR = DATA_DIR;
