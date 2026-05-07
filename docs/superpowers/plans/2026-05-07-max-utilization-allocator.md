# Max Utilization Allocator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Merkl portfolio allocation surface BTC-first EV, idle capital, and ladder-bound proof requests without raising caps or bypassing policy.

**Architecture:** Keep chain-level target weights in `scored-target-balances`; keep single tiny-canary sizing and policy in `merkl-canary-autopilot`; add a pure proof bridge that normalizes proof-missing portfolio candidates into existing canary graduation requests. The portfolio allocator remains a candidate-level planner and emits read-only requests/reports, not bridge/refill/signing actions.

**Tech Stack:** Node `.mjs`, `node:test`, existing BOB Claw config/policy modules, no new dependencies.

---

### Task 1: Proof Graduation Bridge

**Files:**
- Create: `src/executor/canary/proof-graduation-bridge.mjs`
- Test: `test/proof-graduation-bridge.test.mjs`

- [x] Write failing tests for: first rung request, Ethereum min rung, missing `tinyLivePerTxUsd`, and same-opportunity proof not being relaxed.
- [x] Implement a pure helper that calls existing `evaluateCanaryGraduation()` and `sizeMerklCanaryAmount()` with `useTinyLiveCap: true`.
- [x] Return `graduationCanaryRequest` records only; no execution, no signer, no cap mutation.

### Task 2: BTC-First Portfolio Candidate Metrics

**Files:**
- Modify: `src/executor/merkl-portfolio-allocator.mjs`
- Test: `test/merkl-portfolio-allocator.test.mjs`

- [x] Write failing tests for `expectedNetSats` fields, conservative sats conversion, reward haircut, and bridge-cost blocking.
- [x] Add pure BTC/USD conversion helpers and candidate economics fields.
- [x] Keep `expectedNetUsd` projection-only and sort/block by `expectedNetSats`.

### Task 3: Graduation Requests And Idle Report

**Files:**
- Modify: `src/executor/merkl-portfolio-allocator.mjs`
- Test: `test/merkl-portfolio-allocator.test.mjs`

- [x] Write failing tests where proof-missing candidates emit `graduationCanaryRequests` instead of becoming hold entries.
- [x] Add `idleCapitalReport` buckets for bridge-cost loss, min-position blocks, proof-required candidates, and token dust.
- [x] Preserve `entryQueue` proof requirement and `capitalJobs` next-tick annotation behavior.

### Task 4: Autopilot Wiring

**Files:**
- Modify: `src/executor/all-chain-autopilot.mjs`
- Test: `test/all-chain-autopilot.test.mjs`

- [x] Write a failing assertion that all-chain summary exposes portfolio graduation request counts when available.
- [x] Wire summary only; do not execute graduation requests directly from all-chain autopilot.

### Task 5: Research Summary

**Files:**
- Create: `docs/research/max-utilization-allocator.md`

- [x] Document rationale, constraints kept from `AGENTS.md`, overfit guards kept, unchanged surfaces, and the 2026-05-07 capital snapshot example.

### Task 6: Verification

- [x] Run focused tests:
  `node --test test/proof-graduation-bridge.test.mjs test/merkl-portfolio-allocator.test.mjs test/all-chain-autopilot.test.mjs`
- [x] Run `npm run check`.
- [x] Run `npm test`.
