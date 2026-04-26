# Research program

## Goal

Produce reviewable candidate artifacts without touching live execution surfaces.

## Track A

- External agent runner only
- Contract-bounded by environment command and time budget
- Guidance-only when runner env is unset

## Track B

- Deterministic factor generation
- Fixed train / validation / purge / embargo windows
- Daily search stays inside the active candidate limit

## Promotion rule

Promotion evidence is a request for a committed canary diff only. Research may score and emit intent records, but it may not deploy, sign, or mutate runtime policy.

## Isolation

- No live-fund path imports
- No treasury-key references
- No broadcast helpers
- Public dashboard surface stays read-only
