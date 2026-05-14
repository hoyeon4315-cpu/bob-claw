import net from "node:net";
import { getEnv, getNumberEnv } from "../../config/env.mjs";
import { DEFAULT_SIGNER_SOCKET_RELATIVE_PATH, resolveDefaultSignerSocketPath } from "../runtime-paths.mjs";

export const DEFAULT_SIGNER_SOCKET_PATH = DEFAULT_SIGNER_SOCKET_RELATIVE_PATH;

export function signerSocketPath() {
  return getEnv("EXECUTOR_SIGNER_SOCKET_PATH", resolveDefaultSignerSocketPath());
}

export function signerClientTimeoutMs() {
  return getNumberEnv("EXECUTOR_SIGNER_CLIENT_TIMEOUT_MS", 30_000);
}

export async function sendSignerCommand({
  message,
  socketPath = signerSocketPath(),
  timeoutMs = signerClientTimeoutMs(),
} = {}) {
  if (!message || typeof message !== "object") {
    throw new Error("Signer command message is required");
  }

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let settled = false;
    let buffer = "";

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.destroy();
      reject(new Error(`Signer daemon response timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function finish(handler, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end();
      handler(value);
    }

    client.setEncoding("utf8");
    client.once("error", (error) => finish(reject, error));
    client.on("data", (chunk) => {
      buffer += chunk;
      const lineBreak = buffer.indexOf("\n");
      if (lineBreak === -1) return;
      const frame = buffer.slice(0, lineBreak).trim();
      if (!frame) {
        finish(reject, new Error("Signer daemon returned an empty response"));
        return;
      }
      try {
        finish(resolve, JSON.parse(frame));
      } catch (error) {
        finish(reject, new Error(`Signer daemon returned invalid JSON: ${error.message}`));
      }
    });
    client.once("connect", () => {
      client.write(`${JSON.stringify(message)}\n`);
    });
  });
}

export async function readSignerHealth(options = {}) {
  return sendSignerCommand({
    ...options,
    message: {
      command: "health",
    },
  });
}
