# Onchain Opportunity Radar All Phases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a complete internal Onchain Opportunity Radar pipeline from append-only observation ingest through sanitized board reporting without adding live execution.

**Architecture:** The pipeline is read-only until an executable candidate reaches the existing policy engine in a future change. The radar has no signer imports, cap mutation imports, payback policy imports, or kill-switch side effects. External wallet PnL claims remain unverified unless a self replay field is explicitly supplied by future replay code.

**Tech Stack:** Node.js ESM, `node:test`, pure functions, private JSONL under `data/radar`.

---

### Task 1: Observation Ingest

**Files:**
- Create: `src/strategy/radar/jsonl.mjs`
- Create: `src/strategy/radar/observation-ingest.mjs`
- Create: `src/cli/radar-ingest.mjs`
- Test: `test/radar-ingest.test.mjs`
- Test: `test/radar-cli.test.mjs`

- [x] Validate `OpportunityObservation` before writing.
- [x] Append only valid observations to `data/radar/opportunity-observations.jsonl`.
- [x] Return blockers and skip writes for invalid observations.

### Task 2: Strategy Episode Builder

**Files:**
- Create: `src/strategy/radar/strategy-episode-builder.mjs`
- Test: `test/radar-episode-builder.test.mjs`

- [x] Group observations into provisional episodes.
- [x] Preserve external PnL claims as unverified unless `verifiedBy: "self_replay"`.
- [x] Block portability for broken CEX, mixer, or unlabeled attribution paths.

### Task 3: Portable Packet Builder

**Files:**
- Create: `src/strategy/radar/portable-packet-builder.mjs`
- Test: `test/radar-portable-packet.test.mjs`

- [x] Require closed self-replay evidence before portability.
- [x] Require positive self-replay sats before portability.
- [x] Require cluster independence proof before portability.

### Task 4: Executable Candidate Gate

**Files:**
- Create: `src/strategy/radar/executable-candidate-gate.mjs`
- Test: `test/radar-executable-gate.test.mjs`

- [x] Block execution while radar policy thresholds are unresolved.
- [x] Block non-Gateway/manual-bridge paths from executable status.
- [x] Allow an executable result only when explicit calibrated policy is passed to the pure gate.

### Task 5: Realization Fold

**Files:**
- Create: `src/strategy/radar/realization-record-ingest.mjs`
- Test: `test/radar-realization.test.mjs`

- [x] Validate realization records.
- [x] Count `strategyRealized` separately from `paybackDelivered`.
- [x] Sum net realized PnL in sats.

### Task 6: Sanitized Board

**Files:**
- Create: `src/strategy/radar/radar-board.mjs`
- Create: `src/cli/report-radar-board.mjs`
- Test: `test/radar-board.test.mjs`
- Test: `test/radar-cli.test.mjs`

- [x] Build a summary across all radar stages.
- [x] Count candidate blockers.
- [x] Exclude raw event payload hashes from the public board object.

### Task 7: Package Scripts

**Files:**
- Modify: `package.json`

- [x] Add `radar:ingest`.
- [x] Add `report:radar-board`.

### Task 8: Verification

**Files:**
- Test: `test/radar-*.test.mjs`

- [x] Run all radar targeted tests.
- [x] Run syntax checks for all new JS modules.
- [x] Record the baseline limitation: full `npm test` is blocked in this isolated worktree by pre-existing missing dependencies/files from `main`.
