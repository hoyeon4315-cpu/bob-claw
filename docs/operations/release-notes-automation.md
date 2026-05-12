# Release Notes Automation

This repo now ships a release-notes generator that turns real git history into
previewable release notes and a maintained changelog without publishing tags,
GitHub Releases, or deploys.

## What It Does

- Reads commits from a git range, defaulting to `latest tag..HEAD` and falling
  back to the first commit when no tag exists.
- Groups conventional commits into sections such as Features, Fixes, Docs, and
  Chores, while still listing non-conventional commits under Other Changes.
- Includes contributor counts so maintainer and agent-authored changes both
  appear in the generated notes.
- Supports preview-only output to stdout or an artifact file.
- Updates `CHANGELOG.md` only when explicitly asked.

## Safe Commands

Preview the current unreleased notes in the terminal:

```bash
npm run release-notes:preview
```

Preview a PR or custom range:

```bash
npm run release-notes:preview -- --from=<base-ref> --to=<head-ref>
```

Write a standalone markdown file without touching the changelog:

```bash
npm run release-notes:preview -- --write-notes artifacts/release-notes/preview.md
```

Prepend a real release entry to `CHANGELOG.md`:

```bash
npm run release-notes:write -- --version=v0.2.0
```

## Workflow Behavior

`.github/workflows/release-notes-preview.yml` is preview-only.

- On pull requests it generates notes for `base SHA..head SHA`.
- On `workflow_dispatch` it generates notes for an operator-supplied range or
  the repo default range.
- It uses `contents: read` permission only.
- It uploads the rendered markdown as an artifact and posts the same preview to
  the workflow summary.

## Runtime Boundary

The release-notes tooling is intentionally isolated from runtime trading and
operations surfaces.

- It only reads git history and writes markdown files.
- It does not call executor, signer, payback, capital, kill-switch, readiness,
  or deploy commands.
- The workflow does not request write permissions, create tags, publish GitHub
  Releases, or trigger deploys.

## If Live Publishing Is Ever Added

Keep it separate from this preview workflow.

- Use a distinct manual workflow.
- Require explicit `workflow_dispatch`.
- Require `contents: write`.
- Gate tag/release creation behind operator-reviewed inputs.
- Keep changelog generation as a preview step before any publish step.
