import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { sendSignerCommand } from "../src/executor/signer/client.mjs";

test("sendSignerCommand writes a newline-delimited frame and parses the first response", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-signer-client-"));
  const socketPath = join(dir, "signer.sock");
  let received = null;
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      received = JSON.parse(chunk.trim());
      socket.write(`${JSON.stringify({ status: "ok", txHash: "0xabc" })}\n`);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });

  try {
    const response = await sendSignerCommand({
      socketPath,
      timeoutMs: 2_000,
      message: {
        command: "health",
      },
    });
    assert.deepEqual(received, { command: "health" });
    assert.equal(response.status, "ok");
    assert.equal(response.txHash, "0xabc");
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
