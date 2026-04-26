import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDashboardPublicSources } from "../src/dashboard/public-source-check.mjs";

test("dashboard public source check accepts existing local script and link references", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-dashboard-check-"));
  try {
    await writeFile(
      join(dir, "index.html"),
      [
        '<link rel="icon" href="./favicon.ico"/>',
        '<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>',
        '<script src="./data.js"></script>',
      ].join("\n"),
    );
    await writeFile(join(dir, "favicon.ico"), "");
    await writeFile(join(dir, "data.js"), "const DASHBOARD_DATA = {};\n");

    const report = await validateDashboardPublicSources({ publicDir: dir });

    assert.equal(report.ok, true);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(
      report.localReferences.map((item) => item.path),
      ["favicon.ico", "data.js"],
    );
    assert.deepEqual(report.browserBabelUsage, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dashboard public source check reports missing local references", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-dashboard-check-"));
  try {
    await writeFile(
      join(dir, "index.html"),
      '<script src="./missing.js"></script>',
    );

    const report = await validateDashboardPublicSources({ publicDir: dir });

    assert.equal(report.ok, false);
    assert.deepEqual(report.missing, ["missing.js"]);
    assert.deepEqual(report.browserBabelUsage, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dashboard public source check rejects in-browser Babel usage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-dashboard-check-"));
  try {
    await writeFile(
      join(dir, "index.html"),
      [
        '<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>',
        '<script type="text/babel" src="./app.jsx"></script>',
      ].join("\n"),
    );
    await writeFile(join(dir, "app.jsx"), "const App = () => null;\n");

    const report = await validateDashboardPublicSources({ publicDir: dir });

    assert.equal(report.ok, false);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.browserBabelUsage, ["babel-standalone", "text-babel-script"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
