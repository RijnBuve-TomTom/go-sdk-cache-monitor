import maplibregl from "maplibre-gl";
import type { TileEvent, TileEventType } from "../shared/types";
import { packedTileIdToBBox, packedTileIdToLevel } from "../shared/nds";
import type { TileBoundingBox } from "../shared/nds";
import { mapLibreTileIdToBBox, mapLibreTileIdToLevel } from "../shared/mapLibreTile";

// ── API key management (stored in browser localStorage) ──────────────────────

const API_KEY_STORAGE_KEY = "tomtom-api-key";

export function getApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE_KEY);
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

function promptForApiKey(): string | null {
  const key = window.prompt(
    "Enter your TomTom API key\n(get one at https://developer.tomtom.com/)",
  );
  if (key && key.trim()) {
    const trimmed = key.trim();
    localStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
    return trimmed;
  }
  return null;
}

function resolveApiKey(): string | null {
  let key = getApiKey();
  if (!key) {
    key = promptForApiKey();
  }
  return key;
}

// ── Event type → color mapping ───────────────────────────────────────────────

const EVENT_COLORS: Record<TileEventType, string> = {
  hit:        "#34d399",  // green
  miss:       "#f87171",  // red
  download:   "#6c8cff",  // blue
  evict:      "#fbbf24",  // amber
  expiredHit: "#fb923c",  // orange
  update:     "#a78bfa",  // purple
  corruption: "#ef4444",  // bright red
  flush:      "#f472b6",  // pink
};

const EVENT_FILL_OPACITY: Record<TileEventType, number> = {
  hit:        0.18,
  miss:       0.30,
  download:   0.25,
  evict:      0.25,
  expiredHit: 0.20,
  update:     0.20,
  corruption: 0.40,
  flush:      0.35,
};

// ── Tracked tile state ───────────────────────────────────────────────────────

interface TrackedTile {
  tileId: number;
  cache: string;
  events: { event: TileEventType; cache: string; time: number; sizeBytes?: number | null; httpCode?: number | null }[];
  latestEvent: TileEventType;
  addedAt: number;
}

const MAX_TILES = 500;
const TILE_TTL_MS = 60_000; // tiles fade after 60s

const trackedTiles: Map<string, TrackedTile> = new Map();

// ── Source filter state (NDS.Live vs MapVis) ─────────────────────────────────

export type SourceFilterLabel = "NDS.Live" | "MapVis";
export const SOURCE_FILTER_LABELS: readonly SourceFilterLabel[] = ["NDS.Live", "MapVis"] as const;

/**
 * Set of enabled source-filter labels.
 * When empty, no tiles are shown.
 */
const enabledSources: Set<string> = new Set(SOURCE_FILTER_LABELS);

let sourceFilterChangeCallback: ((enabled: Set<string>) => void) | null = null;

export function onSourceFilterChange(cb: (enabled: Set<string>) => void): void {
  sourceFilterChangeCallback = cb;
}

export function getEnabledSources(): ReadonlySet<string> {
  return enabledSources;
}

export function toggleSourceFilter(label: string): void {
  if (enabledSources.has(label)) {
    enabledSources.delete(label);
  } else {
    enabledSources.add(label);
  }
  sourceFilterChangeCallback?.(enabledSources);
  refreshMapSources();
}

/** Check whether a tile's cache passes the current source filter. */
function passesSourceFilter(cache: string): boolean {
  if (enabledSources.size === 0) return false;
  const isNdsLive = cache === "ndsLive";
  if (isNdsLive && enabledSources.has("NDS.Live")) return true;
  if (!isNdsLive && enabledSources.has("MapVis")) return true;
  return false;
}

// ── Level filter state (map-only) ────────────────────────────────────────────

/** Labels for the level filter buttons: "<=10", "10" .. "14", ">=15" */
export const LEVEL_FILTER_LABELS = ["≤10", "10", "11", "12", "13", "14", "≥15"] as const;

/**
 * Set of enabled level-filter labels.
 * When empty, no tiles are shown.
 */
const enabledLevels: Set<string> = new Set(["11", "12", "13", "14", "≥15"]);

/** Callback invoked whenever the level filter changes so the UI can update button states. */
let levelFilterChangeCallback: ((enabled: Set<string>) => void) | null = null;

export function onLevelFilterChange(cb: (enabled: Set<string>) => void): void {
  levelFilterChangeCallback = cb;
}

export function getEnabledLevels(): ReadonlySet<string> {
  return enabledLevels;
}

export function toggleLevelFilter(label: string): void {
  if (enabledLevels.has(label)) {
    enabledLevels.delete(label);
  } else {
    enabledLevels.add(label);
  }
  levelFilterChangeCallback?.(enabledLevels);
  refreshMapSources();
}

export function isLevelFilterActive(label: string): boolean {
  return enabledLevels.has(label);
}

/** Check whether a tile's level passes the current level filter. */
function passesLevelFilter(level: number): boolean {
  // If no filter buttons are active, hide everything
  if (enabledLevels.size === 0) return false;

  if (level < 10 && enabledLevels.has("≤10")) return true;
  if (level === 10 && (enabledLevels.has("10") || enabledLevels.has("≤10"))) return true;
  if (level >= 11 && level <= 14 && enabledLevels.has(String(level))) return true;
  if (level > 15 && enabledLevels.has("≥15")) return true;
  if (level === 15 && (enabledLevels.has("≥15"))) return true;

  return false;
}

/** Refresh map GeoJSON sources to reflect current level filter. */
function refreshMapSources(): void {
  if (!map) return;
  const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(buildFeatureCollection());
  }
  const crossSource = map.getSource(CROSS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (crossSource) {
    crossSource.setData(buildCrossFeatureCollection());
  }
  if (autoZoomEnabled) {
    fitMapToTiles();
  }
}

function tileKey(cache: string, tileId: number): string {
  return `${cache}:${tileId}`;
}

function decodeTile(tile: TrackedTile): { bbox: TileBoundingBox; level: number } {
  if (tile.cache === "ndsLive") {
    return {
      bbox: packedTileIdToBBox(tile.tileId),
      level: packedTileIdToLevel(tile.tileId),
    };
  } else {
    return {
      bbox: mapLibreTileIdToBBox(tile.tileId),
      level: mapLibreTileIdToLevel(tile.tileId),
    };
  }
}

// ── GeoJSON helpers ──────────────────────────────────────────────────────────

function tileToFeature(tile: TrackedTile): GeoJSON.Feature<GeoJSON.Polygon> {
  const { bbox, level } = decodeTile(tile);
  const key = tileKey(tile.cache, tile.tileId);
  return {
    type: "Feature",
    properties: {
      tileKey: key,
      tileId: tile.tileId,
      cache: tile.cache,
      level,
      latestEvent: tile.latestEvent,
      eventCount: tile.events.length,
      hasHistory: tile.events.length > 1 ? 1 : 0,
      color: EVENT_COLORS[tile.latestEvent] ?? "#6c8cff",
      fillOpacity: EVENT_FILL_OPACITY[tile.latestEvent] ?? 0.2,
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [bbox.southWest.lng, bbox.southWest.lat],
        [bbox.southEast.lng, bbox.southEast.lat],
        [bbox.northEast.lng, bbox.northEast.lat],
        [bbox.northWest.lng, bbox.northWest.lat],
        [bbox.southWest.lng, bbox.southWest.lat],
      ]],
    },
  };
}

function buildFeatureCollection(): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return {
    type: "FeatureCollection",
    features: [...trackedTiles.values()]
      .filter(tile => passesSourceFilter(tile.cache) && passesLevelFilter(decodeTile(tile).level))
      .map(tileToFeature),
  };
}

/**
 * Build LineString features for the cross (X) overlay on tiles with history.
 * Each tile with >1 event gets two diagonal lines from corner to corner.
 */
function buildCrossFeatureCollection(): GeoJSON.FeatureCollection<GeoJSON.MultiLineString> {
  const features: GeoJSON.Feature<GeoJSON.MultiLineString>[] = [];

  for (const tile of trackedTiles.values()) {
    if (tile.events.length <= 1) continue;

    const { bbox, level } = decodeTile(tile);
    if (!passesSourceFilter(tile.cache) || !passesLevelFilter(level)) continue;
    const color = EVENT_COLORS[tile.latestEvent] ?? "#6c8cff";

    features.push({
      type: "Feature",
      properties: { color },
      geometry: {
        type: "MultiLineString",
        coordinates: [
          // Diagonal: SW → NE
          [
            [bbox.southWest.lng, bbox.southWest.lat],
            [bbox.northEast.lng, bbox.northEast.lat],
          ],
          // Diagonal: NW → SE
          [
            [bbox.northWest.lng, bbox.northWest.lat],
            [bbox.southEast.lng, bbox.southEast.lat],
          ],
        ],
      },
    });
  }

  return { type: "FeatureCollection", features };
}

// ── Map instance ─────────────────────────────────────────────────────────────

let map: maplibregl.Map | null = null;
let activeDialogs: HTMLElement[] = [];
let dialogZIndex = 400;
let autoZoomEnabled = true;
const SOURCE_ID = "nds-tiles";
const FILL_LAYER_ID = "nds-tiles-fill";
const LINE_LAYER_ID = "nds-tiles-line";
const CROSS_SOURCE_ID = "nds-tiles-cross";
const CROSS_LAYER_ID = "nds-tiles-cross-line";

// ── Draggable tile dialog helpers ─────────────────────────────────────────────

function bringDialogToFront(dialog: HTMLElement): void {
  dialogZIndex++;
  dialog.style.zIndex = String(dialogZIndex);
}

function removeAllDialogs(): void {
  for (const d of activeDialogs) d.remove();
  activeDialogs = [];
}

function createTileDialog(bodyHTML: string, x: number, y: number): HTMLElement {
  const dialog = document.createElement("div");
  dialog.className = "tile-dialog";
  bringDialogToFront(dialog);
  dialog.style.left = `${x}px`;
  dialog.style.top = `${y}px`;

  // Header (drag handle + close button)
  const header = document.createElement("div");
  header.className = "tile-dialog-header";

  const grip = document.createElement("span");
  grip.className = "tile-dialog-grip";
  grip.textContent = "⠿";
  header.appendChild(grip);

  const closeBtn = document.createElement("button");
  closeBtn.className = "tile-dialog-close";
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => {
    dialog.remove();
    activeDialogs = activeDialogs.filter(d => d !== dialog);
  });
  header.appendChild(closeBtn);

  // Body
  const body = document.createElement("div");
  body.className = "tile-popup";
  body.innerHTML = bodyHTML;

  dialog.appendChild(header);
  dialog.appendChild(body);

  // Bring to front on any mousedown inside the dialog
  dialog.addEventListener("mousedown", () => bringDialogToFront(dialog));

  // Dragging via header
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener("mousedown", (e: MouseEvent) => {
    dragging = true;
    dragOffsetX = e.clientX - dialog.offsetLeft;
    dragOffsetY = e.clientY - dialog.offsetTop;
    e.preventDefault(); // prevent text selection
  });

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    dialog.style.left = `${e.clientX - dragOffsetX}px`;
    dialog.style.top = `${e.clientY - dragOffsetY}px`;
  };

  const onMouseUp = () => {
    dragging = false;
  };

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  return dialog;
}

export function initMap(): void {
  const apiKey = resolveApiKey();
  const styleUrl = apiKey
    ? `https://api.tomtom.com/style/1/style/*?map=basic_night&key=${apiKey}`
    : "https://demotiles.maplibre.org/style.json";

  map = new maplibregl.Map({
    container: "map",
    style: styleUrl,
    center: [8.0, 50.0], // Europe center
    zoom: 4,
    attributionControl: {},
  });

  map.addControl(new maplibregl.NavigationControl(), "top-right");

  map.on("load", () => {
    // Add GeoJSON source
    map!.addSource(SOURCE_ID, {
      type: "geojson",
      data: buildFeatureCollection(),
    });

    // Fill layer (colored rectangles)
    map!.addLayer({
      id: FILL_LAYER_ID,
      type: "fill",
      source: SOURCE_ID,
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": ["get", "fillOpacity"],
      },
    });

    // Outline layer
    map!.addLayer({
      id: LINE_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      paint: {
        "line-color": ["get", "color"],
        "line-width": 1.5,
        "line-opacity": 0.7,
      },
    });

    // Cross overlay source + layer (diagonal X on tiles with history)
    map!.addSource(CROSS_SOURCE_ID, {
      type: "geojson",
      data: buildCrossFeatureCollection(),
    });

    map!.addLayer({
      id: CROSS_LAYER_ID,
      type: "line",
      source: CROSS_SOURCE_ID,
      paint: {
        "line-color": ["get", "color"],
        "line-width": 1.5,
        "line-opacity": 0.6,
        "line-dasharray": [4, 2],
      },
    });

    // Click handler for tile dialogs
    map!.on("click", FILL_LAYER_ID, (e) => {
      if (!e.features || e.features.length === 0) return;

      // Remove all existing dialogs
      removeAllDialogs();

      // Deduplicate features by tileKey (MapLibre may return duplicates)
      const seen = new Set<string>();
      const container = document.getElementById("map-container")!;
      let offsetIndex = 0;

      for (const feature of e.features) {
        const key = feature.properties?.tileKey as string;
        if (!key || seen.has(key)) continue;
        seen.add(key);

        const tracked = trackedTiles.get(key);
        if (!tracked) continue;

        const { bbox, level } = decodeTile(tracked);

        // Respect level filter for dialogs
        if (!passesLevelFilter(level)) continue;

        // Build dialog body HTML
        let body = `<div class="tile-popup-header">Tile #${tracked.tileId} <span class="tile-popup-level">L${level}</span> <span class="tile-popup-cache">${tracked.cache}</span></div>`;
        body += `<div class="tile-popup-coords">${bbox.southWest.lat.toFixed(4)}°, ${bbox.southWest.lng.toFixed(4)}° → ${bbox.northEast.lat.toFixed(4)}°, ${bbox.northEast.lng.toFixed(4)}°</div>`;
        body += `<div class="tile-popup-events">`;

        const recentEvents = tracked.events.slice(-10);
        for (const ev of recentEvents) {
          const time = new Date(ev.time).toLocaleTimeString("en-US", { hour12: false });
          const color = EVENT_COLORS[ev.event] ?? "#6c8cff";
          let meta = "";
          if (ev.sizeBytes) meta += ` · ${(ev.sizeBytes / 1024).toFixed(1)} KB`;
          if (ev.httpCode) meta += ` · HTTP ${ev.httpCode}`;
          body += `<div class="tile-popup-event">
            <span class="tile-popup-time">${time}</span>
            <span style="color:${color};font-weight:600">${ev.event}</span>
            <span class="tile-popup-cache">${ev.cache}</span>
            ${meta ? `<span class="tile-popup-meta">${meta}</span>` : ""}
          </div>`;
        }

        if (tracked.events.length > 10) {
          body += `<div class="tile-popup-more">… and ${tracked.events.length - 10} more</div>`;
        }
        body += `</div>`;

        // Calculate pixel position from click point, cascade dialogs
        const clickX = e.point.x + offsetIndex * 24;
        const clickY = e.point.y + offsetIndex * 24;
        offsetIndex++;

        const dialog = createTileDialog(body, clickX, clickY);
        container.appendChild(dialog);
        activeDialogs.push(dialog);
      }
    });

    // Cursor change on hover
    map!.on("mouseenter", FILL_LAYER_ID, () => {
      map!.getCanvas().style.cursor = "pointer";
    });
    map!.on("mouseleave", FILL_LAYER_ID, () => {
      map!.getCanvas().style.cursor = "";
    });
  });
}

// ── Auto-zoom control ────────────────────────────────────────────────────────

export function isAutoZoomEnabled(): boolean {
  return autoZoomEnabled;
}

export function setAutoZoomEnabled(enabled: boolean): void {
  autoZoomEnabled = enabled;
}

function fitMapToTiles(): void {
  if (!map || trackedTiles.size === 0) return;

  const bounds = new maplibregl.LngLatBounds();
  let hasVisibleTile = false;
  for (const tile of trackedTiles.values()) {
    if (!passesSourceFilter(tile.cache)) continue;
    const { bbox, level } = decodeTile(tile);
    if (!passesLevelFilter(level)) continue;
    bounds.extend([bbox.southWest.lng, bbox.southWest.lat]);
    bounds.extend([bbox.northEast.lng, bbox.northEast.lat]);
    hasVisibleTile = true;
  }

  if (!hasVisibleTile) return;
  map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 500 });
}

// ── Public API: clear tiles ──────────────────────────────────────────────────

export function clearTiles(): void {
  trackedTiles.clear();

  removeAllDialogs();

  if (!map) return;
  const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(buildFeatureCollection());
  }
  const crossSource = map.getSource(CROSS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (crossSource) {
    crossSource.setData(buildCrossFeatureCollection());
  }
}

// ── Public API: add tile events ──────────────────────────────────────────────

export function addTileEventsToMap(events: TileEvent[], time: number): void {
  if (!map) return;

  for (const te of events) {
    const key = tileKey(te.cache, te.tileId);
    const existing = trackedTiles.get(key);
    if (existing) {
      existing.events.push({
        event: te.event,
        cache: te.cache,
        time,
        sizeBytes: te.sizeBytes,
        httpCode: te.httpCode,
      });
      existing.latestEvent = te.event;
      existing.addedAt = Date.now();
    } else {
      trackedTiles.set(key, {
        tileId: te.tileId,
        cache: te.cache,
        events: [{
          event: te.event,
          cache: te.cache,
          time,
          sizeBytes: te.sizeBytes,
          httpCode: te.httpCode,
        }],
        latestEvent: te.event,
        addedAt: Date.now(),
      });
    }
  }

  // Prune old tiles
  const now = Date.now();
  for (const [key, tile] of trackedTiles) {
    if (now - tile.addedAt > TILE_TTL_MS) {
      trackedTiles.delete(key);
    }
  }

  // Enforce max tile limit (remove oldest)
  if (trackedTiles.size > MAX_TILES) {
    const sorted = [...trackedTiles.entries()].sort((a, b) => a[1].addedAt - b[1].addedAt);
    const toRemove = sorted.slice(0, trackedTiles.size - MAX_TILES);
    for (const [key] of toRemove) {
      trackedTiles.delete(key);
    }
  }

  // Update map source
  const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(buildFeatureCollection());
  }

  // Update cross overlay source
  const crossSource = map.getSource(CROSS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (crossSource) {
    crossSource.setData(buildCrossFeatureCollection());
  }

  // Auto-zoom to fit all highlighted tiles
  if (autoZoomEnabled) {
    fitMapToTiles();
  }
}

// ── Public API: replay tile events efficiently ───────────────────────────────

/**
 * Replay a series of tile batches onto the map efficiently.
 * Clears existing tiles, replays all events, then updates the map source once.
 */
export function replayTileEventsToMap(
  batches: { events: TileEvent[]; time: number }[],
): void {
  if (!map) return;

  // Clear existing tracked tiles (no map source update yet)
  trackedTiles.clear();
  removeAllDialogs();

  // Replay all batches into tracked tiles
  for (const batch of batches) {
    for (const te of batch.events) {
      const key = tileKey(te.cache, te.tileId);
      const existing = trackedTiles.get(key);
      if (existing) {
        existing.events.push({
          event: te.event,
          cache: te.cache,
          time: batch.time,
          sizeBytes: te.sizeBytes,
          httpCode: te.httpCode,
        });
        existing.latestEvent = te.event;
        existing.addedAt = batch.time;
      } else {
        trackedTiles.set(key, {
          tileId: te.tileId,
          cache: te.cache,
          events: [{
            event: te.event,
            cache: te.cache,
            time: batch.time,
            sizeBytes: te.sizeBytes,
            httpCode: te.httpCode,
          }],
          latestEvent: te.event,
          addedAt: batch.time,
        });
      }
    }
  }

  // Enforce max tile limit (remove oldest)
  if (trackedTiles.size > MAX_TILES) {
    const sorted = [...trackedTiles.entries()].sort((a, b) => a[1].addedAt - b[1].addedAt);
    const toRemove = sorted.slice(0, trackedTiles.size - MAX_TILES);
    for (const [key] of toRemove) {
      trackedTiles.delete(key);
    }
  }

  // Update map sources once
  const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(buildFeatureCollection());
  }
  const crossSource = map.getSource(CROSS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (crossSource) {
    crossSource.setData(buildCrossFeatureCollection());
  }

  if (autoZoomEnabled) {
    fitMapToTiles();
  }
}
