// Balance reconciliation — detect unexpected deltas between two
// treasury inventory snapshots.
//
// Plan §5b.1 (T19). Runs on every Capital Manager tick. Pure function:
// caller supplies prev snapshot, current snapshot, and the list of
// signer-initiated intents broadcast between the two snapshots. Output
// is a deterministic diff with `{expected, unexpected}` deltas.
//
// The signer daemon produces the "expected intents" list from its
// audit log; this module does NOT touch files.

const WEI_ZERO = 0n;

function toBigint(value) {
  if (value == null) return WEI_ZERO;
  if (typeof value === "bigint") return value;
  try {
    return BigInt(value);
  } catch {
    return WEI_ZERO;
  }
}

function keyFor(chain, asset) {
  return `${String(chain).toLowerCase()}::${String(asset).toLowerCase()}`;
}

// Normalize a snapshot into Map<key, {chain, asset, amountWei:bigint, decimals}>
export function normalizeSnapshot(snapshot) {
  const out = new Map();
  if (!snapshot) return out;
  const rows = [
    ...(snapshot.native || []).map((r) => ({ ...r, kind: "native", asset: r.asset || r.token || "native" })),
    ...(snapshot.tokens || []).map((r) => ({ ...r, kind: "token", asset: r.asset || r.token })),
  ];
  for (const r of rows) {
    if (!r.chain || !r.asset) continue;
    const k = keyFor(r.chain, r.asset);
    out.set(k, {
      chain: String(r.chain),
      asset: String(r.asset),
      kind: r.kind,
      decimals: Number.isFinite(r.decimals) ? r.decimals : null,
      amountWei: toBigint(r.actual ?? r.actualWei ?? r.amountWei ?? r.balance),
    });
  }
  return out;
}

// Multiple intents on the same chain/asset are summed.
function aggregateIntents(intents = []) {
  const out = new Map();
  for (const it of intents || []) {
    if (!it || !it.chain || !it.asset) continue;
    const k = keyFor(it.chain, it.asset);
    const prior = out.get(k) ?? WEI_ZERO;
    out.set(k, prior + toBigint(it.deltaWei));
  }
  return out;
}

function absBig(v) {
  return v < 0n ? -v : v;
}

function observedDeltas(prevMap, currMap) {
  const keys = new Set([...prevMap.keys(), ...currMap.keys()]);
  const deltas = [];
  for (const k of keys) {
    const prev = prevMap.get(k);
    const curr = currMap.get(k);
    const prevAmt = prev ? prev.amountWei : WEI_ZERO;
    const currAmt = curr ? curr.amountWei : WEI_ZERO;
    const delta = currAmt - prevAmt;
    if (delta === WEI_ZERO) continue;
    deltas.push({
      key: k,
      chain: (curr || prev).chain,
      asset: (curr || prev).asset,
      kind: (curr || prev).kind,
      prevWei: prevAmt.toString(),
      currWei: currAmt.toString(),
      deltaWei: delta.toString(),
    });
  }
  return deltas;
}

// Reconcile two snapshots against the set of signer-initiated intents.
// A delta is `expected` if it equals the aggregated intent delta for
// the same (chain, asset) within `toleranceWei`. Otherwise `unexpected`.
export function reconcileBalances({
  prevSnapshot,
  currSnapshot,
  expectedIntents = [],
  toleranceWei = "0",
  observedAt = new Date().toISOString(),
} = {}) {
  const prevMap = normalizeSnapshot(prevSnapshot);
  const currMap = normalizeSnapshot(currSnapshot);
  const intents = aggregateIntents(expectedIntents);
  const tol = toBigint(toleranceWei);

  const expected = [];
  const unexpected = [];
  const consumedIntentKeys = new Set();

  for (const row of observedDeltas(prevMap, currMap)) {
    const intentDelta = intents.get(row.key) ?? WEI_ZERO;
    const residual = toBigint(row.deltaWei) - intentDelta;
    const kind = intents.has(row.key) ? "explained" : "unexplained";
    const withinTolerance = absBig(residual) <= tol;

    const rec = {
      ...row,
      expectedDeltaWei: intentDelta.toString(),
      residualDeltaWei: residual.toString(),
      classification: withinTolerance ? "expected" : "unexpected",
      kind,
    };
    if (withinTolerance) {
      expected.push(rec);
      consumedIntentKeys.add(row.key);
    } else {
      unexpected.push(rec);
    }
  }

  // Intents with no observed balance change count as missed deliveries.
  const missing = [];
  for (const [k, delta] of intents.entries()) {
    if (consumedIntentKeys.has(k) || delta === WEI_ZERO) continue;
    if (!prevMap.has(k) && !currMap.has(k)) {
      const [chain, asset] = k.split("::");
      missing.push({
        key: k,
        chain,
        asset,
        expectedDeltaWei: delta.toString(),
        observedDeltaWei: "0",
        classification: "missing",
      });
    }
  }

  const hasAnomaly = unexpected.length > 0 || missing.length > 0;

  return Object.freeze({
    schemaVersion: 1,
    observedAt,
    ok: !hasAnomaly,
    expected: Object.freeze(expected.map((e) => Object.freeze(e))),
    unexpected: Object.freeze(unexpected.map((e) => Object.freeze(e))),
    missing: Object.freeze(missing.map((e) => Object.freeze(e))),
    counts: Object.freeze({
      expected: expected.length,
      unexpected: unexpected.length,
      missing: missing.length,
    }),
    action: hasAnomaly ? "emergency_pause" : "continue",
  });
}

// Build the balance-snapshots.jsonl record. Caller appends the
// JSON-stringified record to logs/balance-snapshots.jsonl; this module
// never touches the file system.
export function buildBalanceSnapshotRecord({
  inventory,
  observedAt = new Date().toISOString(),
  reconciliation = null,
  note = null,
} = {}) {
  const normalized = normalizeSnapshot(inventory);
  const rows = [];
  for (const v of normalized.values()) {
    rows.push({
      chain: v.chain,
      asset: v.asset,
      kind: v.kind,
      decimals: v.decimals,
      amountWei: v.amountWei.toString(),
    });
  }
  rows.sort((a, b) => (a.chain + a.asset).localeCompare(b.chain + b.asset));
  return Object.freeze({
    schemaVersion: 1,
    observedAt,
    rows: Object.freeze(rows.map((r) => Object.freeze(r))),
    reconciliation: reconciliation ? Object.freeze(reconciliation) : null,
    note,
  });
}
