# Changelog

Release notes are generated from conventional commit subjects so reviewers can
see what changed without hand-writing summaries from scratch.

## Unreleased

- Release notes automation is configured through `npm run release-notes:preview`
  and `npm run release-notes:write`.
- The preview workflow renders proposed release notes for pull requests that
  touch release automation, workflows, package metadata, or documentation.
- Maintainers should commit generated entries only for actual release windows,
  keeping this file concise and avoiding large historical snapshots.
