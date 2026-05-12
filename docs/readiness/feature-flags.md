---
status: canonical
updated_at: 2026-05-12
owner: ops-harness
source_of_truth: AGENTS.md
---

# Feature Flag Infrastructure

BOB Claw feature flags are committed source configuration for safe rollout of
non-live code paths. They are not runtime controls for trading authority.

## Implementation

- Manifest and lookup API: `src/config/feature-flags.mjs`
- Focused verification: `npm run check:feature-flags`
- Current non-live consumer: `src/status/feature-flag-catalog-slice.mjs`

The manifest is validated at import/use time. Validation fails for unknown
lookups, missing owner/scope/description/safety boundary, invalid boolean
defaults, id mismatches, and scopes outside the allowlist.

## Allowed Scopes

Feature flags may only use these scopes:

- `dev`
- `report`
- `dashboard`
- `scaffold`
- `non_live_rollout`

Allowed flags may change read-only reports, dashboard display, developer
scaffolding, or non-live rollout metadata. They must keep deterministic
execution behavior unchanged.

## Forbidden Scopes

Feature flags must not control or bypass:

- `autoExecute`
- caps or capital routing authority
- policy approval
- signer approval or signer transport
- kill-switch or auto-kill behavior
- payback ratio, timing, scheduler, or settlement proof
- live runtime execution
- readiness blockers or live eligibility gates

If a future change appears to need a flag in one of these areas, do not add it
as a feature flag. Treat it as a safety design problem requiring an operating
law and deterministic policy/config review.

## Adding A Flag

1. Add a single entry to `FEATURE_FLAGS` in `src/config/feature-flags.mjs`.
2. Set `owner`, allowed `scope`, boolean `defaultEnabled`, `description`,
   `safetyBoundary`, `createdAt`, and `reviewCadence`.
3. Keep the value committed in source. Do not add env, dashboard, Telegram,
   LLM harness, or runtime-file overrides.
4. Add a real non-live consumer or a focused test that demonstrates the lookup.
5. Run `npm run check:feature-flags`.
6. Review the final diff and stage only source/docs/tests/package files.

## Live-Safety Boundary

The feature flag module has no permission to mutate live behavior. BOB Claw
execution remains controlled by committed strategy/payback config,
deterministic policy checks, signer approval, caps, kill-switch, audit logs,
and receipt proof.
