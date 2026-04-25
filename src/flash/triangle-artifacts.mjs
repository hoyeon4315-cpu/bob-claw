import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { listTriangleProfiles, triangleDatasetPaths } from "./triangle-profiles.mjs";

export async function readTriangleArtifacts(dataDir) {
  const artifacts = {};
  for (const profile of listTriangleProfiles()) {
    const paths = triangleDatasetPaths(dataDir, profile.id);
    const [latest, analysis] = await Promise.all([
      readJsonIfExists(paths.latestPath),
      readJsonIfExists(paths.analysisPath),
    ]);
    artifacts[profile.id] = { latest, analysis };
  }
  return artifacts;
}
