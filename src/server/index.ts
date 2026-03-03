import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { AdbBridge } from "./adb-bridge.js";
import type { WsEnvelope, ServerStatus } from "../shared/types.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const isDev = process.env.NODE_ENV !== "production";

// ── HTTP server (serves built client in production) ──────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const httpServer = createServer((req, res) => {
  if (isDev) {
    // In dev mode, Vite serves the client; this server only handles WS
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Cache Monitor WS server. Connect via Vite dev server.");
    return;
  }

  // Production: serve from dist/client
  const url = req.url === "/" ? "/index.html" : req.url ?? "/index.html";
  const filePath = resolve("dist/client", `.${url}`);
  try {
    const data = readFileSync(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

// ── WebSocket server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });
const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`[ws] Client connected (${clients.size} total)`);

  // Send current status
  const status: ServerStatus = {
    type: "status",
    connected: currentDeviceId !== null,
    deviceId: currentDeviceId ?? undefined,
  };
  ws.send(JSON.stringify(status));

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[ws] Client disconnected (${clients.size} total)`);
  });
});

function broadcast(data: WsEnvelope | ServerStatus): void {
  const json = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  }
}

// ── ADB Bridge ───────────────────────────────────────────────────────────────

let currentDeviceId: string | null = null;
const adb = new AdbBridge();

adb.on("message", (msg) => {
  const envelope: WsEnvelope = { source: "adb", message: msg };
  broadcast(envelope);
});

adb.on("connected", (deviceId) => {
  currentDeviceId = deviceId;
  broadcast({ type: "status", connected: true, deviceId });
});

adb.on("disconnected", () => {
  currentDeviceId = null;
  broadcast({ type: "status", connected: false });
});

adb.on("error", (err) => {
  broadcast({ type: "status", connected: false, error: err.message });
});

// ── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[server] Cache Monitor server listening on http://localhost:${PORT}`);
  console.log(`[server] WebSocket available at ws://localhost:${PORT}`);
  if (isDev) {
    console.log(`[server] Run "npm run dev:client" for the Vite frontend`);
  }
});

adb.start();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[server] Shutting down...");
  adb.stop();
  wss.close();
  httpServer.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  adb.stop();
  wss.close();
  httpServer.close();
  process.exit(0);
});
