import assert from "node:assert/strict";
import { test } from "node:test";
import { checkKillSwitch, resolveKillSwitchPath } from "../src/executor/policy/kill-switch.mjs";

test("resolveKillSwitchPath reads env configuration", () => {
  assert.equal(resolveKillSwitchPath({ KILL_SWITCH_PATH: "/tmp/bob.kill" }), "/tmp/bob.kill");
  assert.equal(resolveKillSwitchPath({}), null);
});

test("checkKillSwitch blocks when kill switch file exists", async () => {
  const result = await checkKillSwitch({
    killSwitchPath: "/tmp/bob.kill",
    existsImpl: async () => true,
    now: "2026-04-16T00:00:00.000Z",
  });

  assert.equal(result.decision, "BLOCK");
  assert.deepEqual(result.blockers, ["kill_switch_present"]);
});

test("checkKillSwitch allows when no kill switch file exists", async () => {
  const result = await checkKillSwitch({
    killSwitchPath: "/tmp/bob.kill",
    existsImpl: async () => false,
  });

  assert.equal(result.decision, "ALLOW");
  assert.deepEqual(result.blockers, []);
});
