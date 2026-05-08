import { join } from "node:path";

export const DEFAULT_LIVE_SNAPSHOT_DIR = join("data", "dashboard-live");
export const DASHBOARD_PUBLIC_DIR = join("dashboard", "public");

export function optionMapFromArgs(argv = []) {
  return Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
}

export function hasFlag(argv = [], flag) {
  return argv.includes(flag);
}

export function dashboardLiveSnapshotDir({ options = {}, env = process.env } = {}) {
  return options["live-snapshot-dir"]
    || env.LIVE_SNAPSHOT_DIR
    || env.BOB_CLAW_DASHBOARD_LIVE_SNAPSHOT_DIR
    || DEFAULT_LIVE_SNAPSHOT_DIR;
}

export function dashboardJsonOutputPath(fileName, {
  options = {},
  env = process.env,
  commitPublic = false,
} = {}) {
  if (options.out) return options.out;
  const dir = commitPublic ? DASHBOARD_PUBLIC_DIR : dashboardLiveSnapshotDir({ options, env });
  return join(dir, fileName);
}

export function dashboardJsonCandidatePaths(fileName, {
  rootDir = DASHBOARD_PUBLIC_DIR,
  liveSnapshotDir = DEFAULT_LIVE_SNAPSHOT_DIR,
  dataDir = "data",
} = {}) {
  return [
    join(liveSnapshotDir, fileName),
    join(rootDir, fileName),
    join(dataDir, fileName),
  ];
}
