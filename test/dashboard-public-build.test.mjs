import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardPublic } from "../src/cli/build-dashboard-public.mjs";

test("dashboard public build compiles jsx sources into js assets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-dashboard-build-"));
  try {
    await writeFile(join(dir, "app.jsx"), "const App = () => <div>ok</div>;\n");
    const calls = [];
    const result = await buildDashboardPublic({
      publicDir: dir,
      entries: [{ source: "app.jsx", output: "app.js" }],
      async transformFn(source, options) {
        calls.push({ source, options });
        return { code: "const App = () => React.createElement('div', null, 'ok');" };
      },
    });

    const output = await readFile(join(dir, "app.js"), "utf8");
    assert.equal(result.writes.length, 1);
    assert.equal(result.writes[0].changed, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.loader, "jsx");
    assert.match(output, /Generated from app\.jsx/);
    assert.match(output, /\(\(\) => \{/);
    assert.match(output, /React\.createElement/);
    assert.match(output, /\}\)\(\);/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
