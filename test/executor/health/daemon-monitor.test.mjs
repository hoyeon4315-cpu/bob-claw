import { describe, it } from "node:test";
import assert from "node:assert";
import {
  checkDaemonStatus,
} from "../../src/executor/health/daemon-monitor.mjs";

describe("daemon-monitor", () => {
  it("detects missing PID file and socket", async () => {
    const status = await checkDaemonStatus({
      pidFilePath: "/nonexistent/pid",
      socketPath: "/nonexistent/sock",
      timeoutMs: 1000,
    });

    assert.strictEqual(status.pidFile, null);
    assert.strictEqual(status.pidRunning, false);
    assert.strictEqual(status.socketExists, false);
    assert.strictEqual(status.socketResponding, false);
    assert.strictEqual(status.actionNeeded, true);
    assert.strictEqual(status.action, "restart");
    assert.ok(status.timestamp);
  });
});
