import maplibregl from "maplibre-gl";
import type { TileEvent, TileEventType } from "../shared/types";
import { packedTileIdToBBox, packedTileIdToLevel } from "../shared/nds";
import type { TileBoundingBox } from "../shared/nds";
import { navTileIdToBBox, navTileIdToLevel } from "../shared/navtile";

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
      bbox: navTileIdToBBox(tile.tileId),
      level: navTileIdToLevel(tile.tileId),
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
    features: [...trackedTiles.values()].map(tileToFeature),
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

    const { bbox } = decodeTile(tile);
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
let activePopups: maplibregl.Popup[] = [];
let autoZoomEnabled = true;
const SOURCE_ID = "nds-tiles";
const FILL_LAYER_ID = "nds-tiles-fill";
const LINE_LAYER_ID = "nds-tiles-line";
const CROSS_SOURCE_ID = "nds-tiles-cross";
const CROSS_LAYER_ID = "nds-tiles-cross-line";

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

    // Click handler for popups
    map!.on("click", FILL_LAYER_ID, (e) => {
      if (!e.features || e.features.length === 0) return;

      // Remove all existing popups
      activePopups.forEach(p => p.remove());
      activePopups = [];

      // Deduplicate features by tileKey (MapLibre may return duplicates)
      const seen = new Set<string>();

      for (const feature of e.features) {
        const key = feature.properties?.tileKey as string;
        if (!key || seen.has(key)) continue;
        seen.add(key);

        const tracked = trackedTiles.get(key);
        if (!tracked) continue;

        const { bbox, level } = decodeTile(tracked);
        const centerLng = (bbox.southWest.lng + bbox.northEast.lng) / 2;
        const centerLat = (bbox.southWest.lat + bbox.northEast.lat) / 2;

        // Build popup HTML
        let html = `<div class="tile-popup">`;
        html += `<div class="tile-popup-header">Tile #${tracked.tileId} <span class="tile-popup-level">L${level}</span> <span class="tile-popup-cache">${tracked.cache}</span></div>`;
        html += `<div class="tile-popup-coords">${bbox.southWest.lat.toFixed(4)}°, ${bbox.southWest.lng.toFixed(4)}° → ${bbox.northEast.lat.toFixed(4)}°, ${bbox.northEast.lng.toFixed(4)}°</div>`;
        html += `<div class="tile-popup-events">`;

        const recentEvents = tracked.events.slice(-10);
        for (const ev of recentEvents) {
          const time = new Date(ev.time).toLocaleTimeString("en-US", { hour12: false });
          const color = EVENT_COLORS[ev.event] ?? "#6c8cff";
          let meta = "";
          if (ev.sizeBytes) meta += ` · ${(ev.sizeBytes / 1024).toFixed(1)} KB`;
          if (ev.httpCode) meta += ` · HTTP ${ev.httpCode}`;
          html += `<div class="tile-popup-event">
            <span class="tile-popup-time">${time}</span>
            <span style="color:${color};font-weight:600">${ev.event}</span>
            <span class="tile-popup-cache">${ev.cache}</span>
            ${meta ? `<span class="tile-popup-meta">${meta}</span>` : ""}
          </div>`;
        }

        if (tracked.events.length > 10) {
          html += `<div class="tile-popup-more">… and ${tracked.events.length - 10} more</div>`;
        }

        html += `</div></div>`;

        const popup = new maplibregl.Popup({ closeOnClick: true, maxWidth: "340px" })
          .setLngLat([centerLng, centerLat])
          .setHTML(html)
          .addTo(map!);
        activePopups.push(popup);
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
  for (const tile of trackedTiles.values()) {
    const { bbox } = decodeTile(tile);
    bounds.extend([bbox.southWest.lng, bbox.southWest.lat]);
    bounds.extend([bbox.northEast.lng, bbox.northEast.lat]);
  }

  map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 500 });
}

// ── Public API: clear tiles ──────────────────────────────────────────────────

export function clearTiles(): void {
  trackedTiles.clear();

  activePopups.forEach(p => p.remove());
  activePopups = [];

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
