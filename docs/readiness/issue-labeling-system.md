# Issue Labeling System

This repository uses prefixed GitHub labels so agents can filter issues by
priority, type, area, and safety/readiness concerns without relying on GitHub's
default labels alone.

This document and `.github/labels.yml` describe the intended taxonomy.
`.github/workflows/label-sync.yml` applies the taxonomy to GitHub labels on
changes to the tracked label file, and can also be run manually with
`workflow_dispatch`.

## Required Prefixes

- `priority/*` for urgency from `priority/P0` through `priority/P3`
- `type/*` for work category such as `type/bug` and `type/docs`
- `area/*` for the affected subsystem or ownership surface
- `safety/*` and `readiness/*` for cross-cutting operational handling

## Current Taxonomy Source

The additive label set is tracked in `.github/labels.yml`. Existing GitHub
default labels remain untouched. New labels are created or updated in place; do
not delete or rename existing labels as part of readiness work. The structured
issue templates point at this prefixed taxonomy instead of creating parallel
unprefixed names.

## Sync Runbook

List current labels:

```bash
gh label list --limit 200
```

Create or update the tracked taxonomy from `.github/labels.yml` locally:

```bash
python3 - <<'PY'
import subprocess
import yaml
from pathlib import Path

labels = yaml.safe_load(Path('.github/labels.yml').read_text())
existing = {
    line.split('\t', 1)[0]
    for line in subprocess.check_output(
        ['gh', 'label', 'list', '--limit', '200'],
        text=True,
    ).splitlines()
    if line.strip()
}

for label in labels:
    args = ['gh', 'label']
    if label['name'] in existing:
        args += [
            'edit',
            label['name'],
            '--color',
            label['color'],
            '--description',
            label['description'],
        ]
    else:
        args += [
            'create',
            label['name'],
            '--color',
            label['color'],
            '--description',
            label['description'],
        ]
    subprocess.run(args, check=True)
PY
```

Re-list labels after sync and quote the exact relevant lines in readiness
verification output. If GitHub write permission is missing, report that exact
CLI error and keep this repo-local taxonomy as the source of truth for later
application.

The preferred automation path is the `label-sync` workflow:

```bash
gh workflow run label-sync.yml
gh run list --workflow=label-sync.yml --limit 5
```
