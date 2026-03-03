// ── Cache Types ──────────────────────────────────────────────────────────────

export const CACHE_TYPES = [
  "ndsLive",
  "mapVector",
  "hillshade",
  "satellite",
  "tile3d",
  "trafficIncidentVector",
  "trafficFlowVector",
  "mapRaster",
  "trafficIncidentRaster",
  "trafficFlowRaster",
  "extendedMapVector",
  "extendedTrafficIncident",
  "extendedTrafficFlow",
  "deltaExtendedMap",
  "compressedHillshade",
  "mapDataStore",
  "other",
] as const;

export type CacheType = (typeof CACHE_TYPES)[number];

// ── Tile Event Types ─────────────────────────────────────────────────────────

export const TILE_EVENT_TYPES = [
  "hit",
  "miss",
  "expiredHit",
  "download",
  "evict",
  "flush",
  "corruption",
  "update",
] as const;

export type TileEventType = (typeof TILE_EVENT_TYPES)[number];

// ── Tile Event (inside tileBatch) ────────────────────────────────────────────

export interface TileEvent {
  cache: CacheType;
  tileId: number;
  event: TileEventType;
  sizeBytes?: number | null;
  httpCode?: number | null;
  trigger?: string | null;
  ageSeconds?: number | null;
}

// ── Message: tileBatch ───────────────────────────────────────────────────────

export interface TileBatchMessage {
  type: "tileBatch";
  time: number;
  events: TileEvent[];
}

// ── Cache Statistics (inside cacheStats) ─────────────────────────────────────

export interface CacheStatistics {
  tileCount: number;
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  hitRatio: number;
  totalDownloadedBytes: number;
  diskUsedBytes: number;
  diskConfiguredBytes: number;
  diskRemainingBytes: number;
  evictions: number;
  averageTileAgeSeconds: number;
  downloadsAfterEviction: number;
  flushes: number;
  corruptions: number;
  totalUploadedBytes: number;
}

// ── Message: cacheStats ──────────────────────────────────────────────────────

export interface CacheStatsMessage {
  type: "cacheStats";
  time: number;
  caches: Partial<Record<CacheType, CacheStatistics>>;
}

// ── Message: cacheEvent ──────────────────────────────────────────────────────

export interface CacheEventMessage {
  type: "cacheEvent";
  time: number;
  cache: CacheType;
  event: string;
  reason?: string | null;
  tilesFlushed?: number | null;
  bytesFlushed?: number | null;
}

// ── Union of all message types ───────────────────────────────────────────────

export type CacheMonitorMessage =
  | TileBatchMessage
  | CacheStatsMessage
  | CacheEventMessage;

// ── WebSocket wrapper (server → client) ──────────────────────────────────────

export interface WsEnvelope {
  source: "adb" | "demo";
  message: CacheMonitorMessage;
}

// ── Server status ────────────────────────────────────────────────────────────

export interface ServerStatus {
  type: "status";
  connected: boolean;
  deviceId?: string;
  error?: string;
}
