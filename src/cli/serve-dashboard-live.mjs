#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { config } from "../config/env.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";

const ROOT = resolve(process.cwd(), "dashboard/public");
const DEFAULT_PORT = 8787;
const DEFAULT_STREAM_MS = 3000;

function parseArgs(argv) {
  return argv.reduce((acc, item) => {
    if (item.startsWith("--port=")) acc.port = Number(item.split("=")[1]);
    if (item.startsWith("--stream-ms=")) acc.streamMs = Number(item.split("=")[1]);
    if (item.startsWith("--data-dir=")) acc.dataDir = item.slice("--data-dir=".length);
    if (item.startsWith("--address=")) acc.address = item.slice("--address=".length);
    return acc;
  }, {
    port: DEFAULT_PORT,
    streamMs: DEFAULT_STREAM_MS,
    dataDir: config.dataDir,
    address: null,
  });
}

function contentTypeFor(path) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jsx": "text/plain; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
  })[extname(path).toLowerCase()] || "application/octet-stream";
}

function resolveStaticPath(requestPath = "/") {
  const path = requestPath.split("?")[0] || "/";
  const relative = path === "/" ? "/index.html" : path;
  const resolved = resolve(ROOT, `.${relative}`);
  if (!resolved.startsWith(ROOT)) return null;
  return resolved;
}

async function loadStaticFallback() {
  const text = await readFile(join(ROOT, "dashboard-status.json"), "utf8");
  return JSON.parse(text);
}

async function buildLiveStatus({ dataDir, address, streamMs }) {
  try {
    const context = await buildCurrentDashboardContext({ dataDir, address });
    return {
      ...context.dashboardStatus,
      liveTransport: {
        mode: "local_read_only_api",
        source: "live-api",
        snapshotPath: "/api/live-status",
        eventsPath: "/api/live-events",
        refreshIntervalMs: streamMs,
        servedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    const fallback = await loadStaticFallback();
    return {
      ...fallback,
      liveTransport: {
        mode: "static_fallback",
        source: "dashboard-status.json",
        snapshotPath: "/api/live-status",
        eventsPath: "/api/live-events",
        refreshIntervalMs: streamMs,
        servedAt: new Date().toISOString(),
        error: error.message,
      },
    };
  }
}

async function serveSnapshot(res, options) {
  const status = await buildLiveStatus(options);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(status));
}

function serveEvents(req, res, options) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: ${options.streamMs}\n\n`);

  let closed = false;
  let inFlight = false;
  const sendSnapshot = async () => {
    if (closed || inFlight) return;
    inFlight = true;
    try {
      const status = await buildLiveStatus(options);
      res.write(`event: snapshot\ndata: ${JSON.stringify(status)}\n\n`);
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
    } finally {
      inFlight = false;
    }
  };

  const tick = setInterval(sendSnapshot, options.streamMs);
  const heartbeat = setInterval(() => {
    if (!closed) res.write(`: keepalive ${Date.now()}\n\n`);
  }, 15000);

  sendSnapshot();
  req.on("close", () => {
    closed = true;
    clearInterval(tick);
    clearInterval(heartbeat);
  });
}

async function serveStatic(res, path) {
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      "Content-Type": contentTypeFor(path),
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Method not allowed");
        return;
      }
      const url = req.url || "/";
      if (url.startsWith("/api/live-status")) {
        await serveSnapshot(res, options);
        return;
      }
      if (url.startsWith("/api/live-events")) {
        serveEvents(req, res, options);
        return;
      }
      const path = resolveStaticPath(url);
      if (!path) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Invalid path");
        return;
      }
      await serveStatic(res, path);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error.message }));
    }
  });

  await new Promise((resolvePromise) => server.listen(options.port, resolvePromise));
  console.log(`dashboardLive=http://localhost:${options.port}`);
  console.log(`snapshot=http://localhost:${options.port}/api/live-status`);
  console.log(`events=http://localhost:${options.port}/api/live-events`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
