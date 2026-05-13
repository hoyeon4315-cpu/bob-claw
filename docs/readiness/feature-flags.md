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
defaults, invalid profile overrides, id mismatches, and scopes outside the
allowlist.

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

## Allowed Profiles

Feature flags may optionally declare committed profile overrides for these
non-live profiles:

- `ci`
- `dashboard_preview`
- `local_dev`
- `non_live_rollout`
- `report_snapshot`
- `scaffold_review`

Profiles are explicit caller input to the lookup API. They are not environment
variables, dashboard state, Telegram commands, runtime files, or LLM side
channels.

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
3. Add `profileOverrides` only when the variation is still non-live and still
   safe if committed in source. Keep profile values boolean and limited to the
   allowlist.
4. Keep the value committed in source. Do not add env, dashboard, Telegram,
   LLM harness, or runtime-file overrides.
5. Pass `profile` explicitly from a non-live caller when a profile-specific
   lookup is needed. Unknown profiles fail closed.
6. Add a real non-live consumer or a focused test that demonstrates the lookup.
7. Run `npm run check:feature-flags`.
8. Review the final diff and stage only source/docs/tests/package files.

## Agent Rollout Guidance

Agents should use feature flags only for non-live rollout surfaces such as
read-only reports, dashboard previews, scaffolding, CI-only snapshots, and
other committed metadata views.

- Prefer `defaultEnabled` for the steady-state committed behavior.
- Use `profileOverrides` only when the same flag needs a different non-live
  presentation in a known profile like `ci` or `report_snapshot`.
- Pass the profile explicitly to the lookup API. Do not infer it from env or
  mutable runtime context.
- If a proposed flag affects policy, signer transport, kill-switches, caps,
  payback, live eligibility, or readiness gating, stop and redesign it as
  deterministic policy/config work instead of a feature flag.

## Live-Safety Boundary

The feature flag module has no permission to mutate live behavior. BOB Claw
execution remains controlled by committed strategy/payback config,
deterministic policy checks, signer approval, caps, kill-switch, audit logs,
and receipt proof.
