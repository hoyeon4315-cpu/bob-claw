# Onchain Opportunity Radar Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the Phase 0 schema, policy, and source-provenance foundation for an all-chain Onchain Opportunity Radar without adding execution behavior.

**Architecture:** The radar is a read-only observation-side extension. Phase 0 creates frozen config objects and pure schema validators only; live movement remains exclusively in the existing proposer -> policy -> signer -> receipt ledger path. Threshold values that require calibration stay `null` until an operator-approved policy diff supplies data-backed values.

**Tech Stack:** Node.js ESM, `node:test`, pure validation functions, frozen config objects.

---

### Task 1: Add Radar Schema Tests

**Files:**
- Create: `test/radar-schema.test.mjs`
- Create: `test/radar-policy.test.mjs`
- Create: `test/radar-boundary.test.mjs`

- [x] **Step 1: Write failing tests**

Tests must cover:

- Complete `OpportunityObservation` validation.
- Missing field and enum rejection.
- External wallet PnL claim separation from self replay.
- `PortableOpportunityPacket` required evidence fields.
- `ExecutableCandidate` review-only blockers.
- `OpportunityRealizationRecord` separation between `strategyRealized` and `paybackDelivered`.
- Radar modules must not import signer, strategy caps, payback config, or kill-switch policy modules.

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
node --test test/radar-schema.test.mjs test/radar-policy.test.mjs test/radar-boundary.test.mjs
```

Expected: fail because radar config and schema modules do not exist.

### Task 2: Add Policy and Source Allowlist

**Files:**
- Create: `src/config/radar-policy.mjs`
- Create: `src/config/radar-source-allowlist.mjs`

- [x] **Step 1: Implement frozen policy object**

Create `RADAR_POLICY` with:

- profile id
- `calibrationStatus: "unresolved_operator_policy"`
- stage order
- BTC-first and existing-policy-path booleans
- threshold keys with `null` values
- separate realization state labels

- [x] **Step 2: Implement source allowlist**

Create `RADAR_SOURCE_ALLOWLIST` with entries for raw EVM RPC, Bitcoin Core RPC, Etherscan V2, Blockscout, Dune, DefiLlama, Merkl, Nansen, Arkham, and Cielo. Each entry must include what the source proves, what it cannot prove, freshness fields, and reconciliation requirements.

### Task 3: Add Schema Validators

**Files:**
- Create: `src/strategy/radar/schema/common.mjs`
- Create: `src/strategy/radar/schema/observation.mjs`
- Create: `src/strategy/radar/schema/episode.mjs`
- Create: `src/strategy/radar/schema/packet.mjs`
- Create: `src/strategy/radar/schema/candidate.mjs`
- Create: `src/strategy/radar/schema/record.mjs`
- Create: `src/strategy/radar/schema/index.mjs`

- [x] **Step 1: Implement shared validation helpers**

Add `deepFreeze`, `validationResult`, missing-field detection, enum validation, array validation, and blocker compaction.

- [x] **Step 2: Implement evidence packet validators**

Each validator returns:

```javascript
{
  ok: boolean,
  blockers: string[],
  value: object | null,
}
```

Missing fields produce `missing_<field>` blockers. Invalid enums produce `invalid_<field>` blockers.

- [x] **Step 3: Implement realization lifecycle normalization**

`OpportunityRealizationRecord` adds:

```javascript
lifecycle: {
  strategyRealized: boolean,
  paybackDelivered: boolean,
}
```

Strategy realization must not require BTC L1 payback delivery.

### Task 4: Add Research Note

**Files:**
- Create: `docs/research/onchain-opportunity-radar.md`

- [x] **Step 1: Document Phase 0 scope**

The note must state that Radar is discovery-only, broad in observation scope, narrow in execution scope, and does not make profitability claims from external wallet transactions.

- [x] **Step 2: Document non-goals**

The note must explicitly exclude live execution, external API calls, dashboard raw JSONL exposure, cap mutation, payback policy mutation, and auto-whitelisting.

### Task 5: Verify

**Files:**
- Test: `test/radar-schema.test.mjs`
- Test: `test/radar-policy.test.mjs`
- Test: `test/radar-boundary.test.mjs`

- [x] **Step 1: Run targeted tests**

Run:

```bash
node --test test/radar-schema.test.mjs test/radar-policy.test.mjs test/radar-boundary.test.mjs
```

Expected: all radar Phase 0 tests pass.

- [x] **Step 2: Run syntax checks for new files**

Run:

```bash
node --check src/config/radar-policy.mjs
node --check src/config/radar-source-allowlist.mjs
node --check src/strategy/radar/schema/common.mjs
node --check src/strategy/radar/schema/observation.mjs
node --check src/strategy/radar/schema/episode.mjs
node --check src/strategy/radar/schema/packet.mjs
node --check src/strategy/radar/schema/candidate.mjs
node --check src/strategy/radar/schema/record.mjs
node --check src/strategy/radar/schema/index.mjs
```

Expected: all checks exit with code 0.

### Known Baseline Issue

The isolated worktree was created from `main`, while the original workspace contains uncommitted files used by some broader tests. A broad `npm test` baseline fails in the isolated worktree because dependencies are not installed there and because some currently referenced helper modules such as `src/lib/json-safe.mjs` and `src/lib/shell-quote.mjs` are absent from `main`. Phase 0 verification therefore uses targeted tests and syntax checks for the new files only.
