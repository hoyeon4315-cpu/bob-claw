import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { validateDependencyReleaseAgePolicy } from "../scripts/check-dependency-release-age-policy.mjs";

const POLICY_DOCUMENT = `---
dependency_release_age_policy:
  minimum_days:
    npm: 7
    github_actions: 7
  emergency_exception: operator/security review required
  automation_gap_behavior: manual reviewer enforcement required until dependency update automation is merged
  auto_merge: prohibited
---

# Dependency Release Age Policy

- npm dependency updates must wait at least 7 days after the upstream release before merge.
- GitHub Actions dependency updates must wait at least 7 days after the upstream release before merge.
`;

async function makeTempRepo() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bob-claw-release-age-"));
}

async function writeFile(repoRoot, relativePath, content) {
  const targetPath = path.join(repoRoot, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content);
}

test("passes in policy-only mode when no automation config is present", async () => {
  const repoRoot = await makeTempRepo();
  await writeFile(repoRoot, "docs/readiness/dependency-release-age-policy.md", POLICY_DOCUMENT);

  const result = validateDependencyReleaseAgePolicy({ repoRoot });

  assert.equal(result.dependabotPath, null);
  assert.equal(result.renovatePath, null);
  assert.ok(
    result.messages.includes(
      "AUTOMATION_STATUS policy-only; no local Dependabot or Renovate config found in this branch",
    ),
  );
});

test("fails when policy metadata is missing github actions minimum days", async () => {
  const repoRoot = await makeTempRepo();
  await writeFile(
    repoRoot,
    "docs/readiness/dependency-release-age-policy.md",
    POLICY_DOCUMENT.replace("    github_actions: 7\n", ""),
  );

  assert.throws(
    () => validateDependencyReleaseAgePolicy({ repoRoot }),
    /minimum_days\.github_actions must be a positive integer/,
  );
});

test("fails when Dependabot cooldown is shorter than the policy minimum", async () => {
  const repoRoot = await makeTempRepo();
  await writeFile(repoRoot, "docs/readiness/dependency-release-age-policy.md", POLICY_DOCUMENT);
  await writeFile(
    repoRoot,
    ".github/dependabot.yml",
    `version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    cooldown:
      default-days: 3
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    cooldown:
      default-days: 7
`,
  );

  assert.throws(
    () => validateDependencyReleaseAgePolicy({ repoRoot }),
    /cooldown is 3 days but policy requires at least 7/,
  );
});
