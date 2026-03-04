/**
 * Demo mode: generates realistic fake CacheMonitor messages and broadcasts
 * them via the same WebSocket server, so you can develop/test the UI
 * without a connected Android device.
 *
 * Usage: npm run demo
 */

import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type {
  CacheMonitorMessage,
  TileBatchMessage,
  CacheStatsMessage,
  CacheEventMessage,
  LifecycleEventMessage,
  TileEvent,
  CacheType,
  TileEventType,
  WsEnvelope,
  ServerStatus,
  CacheStatistics,
} from "../shared/types.js";
import { lngLatToPackedTileId } from "../shared/nds.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);

// ── Helpers ──────────────────────────────────────────────────────────────────

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

// ── Simulated cache state ────────────────────────────────────────────────────

const ACTIVE_CACHES: CacheType[] = [
  "ndsLive",
  "mapVector",
  "hillshade",
  "satellite",
  "trafficFlowVector",
];

const EVENT_WEIGHTS: [TileEventType, number][] = [
  ["hit", 45],
  ["miss", 15],
  ["download", 20],
  ["expiredHit", 5],
  ["evict", 8],
  ["update", 5],
  ["corruption", 1],
  ["flush", 1],
];

function weightedEvent(): TileEventType {
  const total = EVENT_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [evt, w] of EVENT_WEIGHTS) {
    r -= w;
    if (r <= 0) return evt;
  }
  return "hit";
}

// Per-cache cumulative stats
const stats: Record<string, CacheStatistics> = {};

for (const c of ACTIVE_CACHES) {
  stats[c] = {
    tileCount: randInt(50, 300),
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    hitRatio: 0,
    totalDownloadedBytes: 0,
    diskUsedBytes: randInt(500_000, 2_000_000),
    diskConfiguredBytes: 10_485_760, // 10 MB
    diskRemainingBytes: 0,
    evictions: 0,
    averageTileAgeSeconds: rand(60, 600),
    downloadsAfterEviction: 0,
    flushes: 0,
    corruptions: 0,
    totalUploadedBytes: 0,
  };
  stats[c].diskRemainingBytes =
    stats[c].diskConfiguredBytes - stats[c].diskUsedBytes;
}

// ── Generate tile batch ──────────────────────────────────────────────────────

// Pre-compute a pool of realistic NDS.Live packed tile IDs around European cities
const TILE_LEVEL = 13;
const CITY_CENTERS = [
  { lng: 4.8952, lat: 52.3702 },   // Amsterdam
  { lng: 4.3517, lat: 50.8503 },   // Brussels
  { lng: 13.4050, lat: 52.5200 },  // Berlin
  { lng: 2.3522, lat: 48.8566 },   // Paris
  { lng: -0.1276, lat: 51.5074 },  // London
  { lng: 12.4964, lat: 41.9028 },  // Rome
  { lng: -3.7038, lat: 40.4168 },  // Madrid
  { lng: 14.4378, lat: 50.0755 },  // Prague
  { lng: 16.3738, lat: 48.2082 },  // Vienna
  { lng: 21.0122, lat: 52.2297 },  // Warsaw
];

function generateNdsTileId(): number {
  const city = pick(CITY_CENTERS);
  // Add jitter: ~0.2 degrees around city center so tiles cluster nearby
  const lng = city.lng + (Math.random() - 0.5) * 0.4;
  const lat = city.lat + (Math.random() - 0.5) * 0.4;
  return lngLatToPackedTileId({ lng, lat }, TILE_LEVEL);
}

function generateTileBatch(): TileBatchMessage {
  const count = randInt(1, 8);
  const events: TileEvent[] = [];

  for (let i = 0; i < count; i++) {
    const cache = pick(ACTIVE_CACHES);
    const event = weightedEvent();
    const tileId = generateNdsTileId();

    const te: TileEvent = { cache, tileId, event };

    // Populate optional fields based on event type
    if (event === "download") {
      te.sizeBytes = randInt(1024, 65536);
      te.httpCode = pick([200, 200, 200, 200, 304, 404, 500]);
      te.trigger = pick(["alongRoute", "viewport", "prefetch", "background"]);
      stats[cache].totalDownloadedBytes += te.sizeBytes;
      stats[cache].diskUsedBytes += te.sizeBytes;
      stats[cache].diskRemainingBytes =
        stats[cache].diskConfiguredBytes - stats[cache].diskUsedBytes;
      stats[cache].tileCount++;
    }

    if (event === "hit" || event === "expiredHit") {
      te.ageSeconds = Math.round(rand(1, 3600) * 10) / 10;
      stats[cache].cacheHits++;
    }

    if (event === "miss") {
      stats[cache].cacheMisses++;
    }

    if (event === "evict") {
      te.ageSeconds = Math.round(rand(60, 7200) * 10) / 10;
      te.sizeBytes = randInt(1024, 65536);
      stats[cache].evictions++;
      stats[cache].tileCount = Math.max(0, stats[cache].tileCount - 1);
      stats[cache].diskUsedBytes = Math.max(
        0,
        stats[cache].diskUsedBytes - (te.sizeBytes ?? 0),
      );
      stats[cache].diskRemainingBytes =
        stats[cache].diskConfiguredBytes - stats[cache].diskUsedBytes;
    }

    if (event === "corruption") {
      stats[cache].corruptions++;
    }

    stats[cache].totalRequests++;
    stats[cache].hitRatio =
      stats[cache].totalRequests > 0
        ? stats[cache].cacheHits / stats[cache].totalRequests
        : 0;

    events.push(te);
  }

  return { type: "tileBatch", time: Date.now(), events };
}

// ── Generate cache stats ─────────────────────────────────────────────────────

function generateCacheStats(): CacheStatsMessage {
  const caches: Partial<Record<CacheType, CacheStatistics>> = {};
  for (const c of ACTIVE_CACHES) {
    // Compute rolling average age
    stats[c].averageTileAgeSeconds += rand(-5, 15);
    if (stats[c].averageTileAgeSeconds < 0) stats[c].averageTileAgeSeconds = 0;

    caches[c] = { ...stats[c] };
  }
  return { type: "cacheStats", time: Date.now(), caches };
}

// ── Generate cache event (rare) ──────────────────────────────────────────────

function generateCacheEvent(): CacheEventMessage {
  const cache = pick(ACTIVE_CACHES);
  const isFlush = Math.random() > 0.3;
  if (isFlush) {
    const tilesFlushed = stats[cache].tileCount;
    const bytesFlushed = stats[cache].diskUsedBytes;
    stats[cache].tileCount = 0;
    stats[cache].diskUsedBytes = 0;
    stats[cache].diskRemainingBytes = stats[cache].diskConfiguredBytes;
    stats[cache].flushes++;
    return {
      type: "cacheEvent",
      time: Date.now(),
      cache,
      event: "flush",
      reason: pick(["userRequested", "lowMemory", "appUpdate"]),
      tilesFlushed,
      bytesFlushed,
    };
  }
  stats[cache].corruptions++;
  return {
    type: "cacheEvent",
    time: Date.now(),
    cache,
    event: "corruption",
    reason: "checksumMismatch",
  };
}

// ── WebSocket server ─────────────────────────────────────────────────────────

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Cache Monitor DEMO server. Connect via Vite dev server.");
});

const wss = new WebSocketServer({ server: httpServer });
const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`[demo-ws] Client connected (${clients.size} total)`);

  const status: ServerStatus = {
    type: "status",
    connected: true,
    deviceId: "demo-device-001",
  };
  ws.send(JSON.stringify(status));

  // Send lifecycle "started" to the newly connected client
  const lifecycleEnvelope: WsEnvelope = {
    source: "demo",
    message: generateLifecycleEvent("started"),
  };
  ws.send(JSON.stringify(lifecycleEnvelope));

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[demo-ws] Client disconnected (${clients.size} total)`);
  });
});

function broadcast(msg: CacheMonitorMessage): void {
  const envelope: WsEnvelope = { source: "demo", message: msg };
  const json = JSON.stringify(envelope);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  }
}

// ── Lifecycle events ─────────────────────────────────────────────────────────

function generateLifecycleEvent(
  event: "started" | "stopped",
): LifecycleEventMessage {
  return { type: "lifecycleEvent", time: Date.now(), event };
}

// ── Timers ───────────────────────────────────────────────────────────────────

// Tile batches every 250ms
setInterval(() => {
  if (clients.size === 0) return;
  broadcast(generateTileBatch());
}, 250);

// Cache stats every 15s
setInterval(() => {
  if (clients.size === 0) return;
  broadcast(generateCacheStats());
}, 15_000);

// Rare cache events (flush/corruption) every 30–90s
function scheduleCacheEvent(): void {
  const delay = randInt(30_000, 90_000);
  setTimeout(() => {
    if (clients.size > 0) {
      broadcast(generateCacheEvent());
    }
    scheduleCacheEvent();
  }, delay);
}
scheduleCacheEvent();

// ── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[demo] Cache Monitor DEMO server on http://localhost:${PORT}`);
  console.log(`[demo] Generating fake data for caches: ${ACTIVE_CACHES.join(", ")}`);
  console.log(`[demo] Open the Vite dev server (default http://localhost:5173) in your browser`);

  // Broadcast lifecycle "started" event once the server is ready
  broadcast(generateLifecycleEvent("started"));
});

process.on("SIGINT", () => {
  console.log("\n[demo] Shutting down...");
  broadcast(generateLifecycleEvent("stopped"));
  wss.close();
  httpServer.close();
  process.exit(0);
});
