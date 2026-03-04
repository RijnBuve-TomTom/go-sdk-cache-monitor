import maplibregl from "maplibre-gl";
import type { TileEvent, TileEventType } from "../shared/types";
import { packedTileIdToBBox, packedTileIdToLevel } from "../shared/nds";

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
  events: { event: TileEventType; cache: string; time: number; sizeBytes?: number | null; httpCode?: number | null }[];
  latestEvent: TileEventType;
  addedAt: number;
}

const MAX_TILES = 500;
const TILE_TTL_MS = 60_000; // tiles fade after 60s

const trackedTiles: Map<number, TrackedTile> = new Map();

// ── GeoJSON helpers ──────────────────────────────────────────────────────────

function tileToFeature(tile: TrackedTile): GeoJSON.Feature<GeoJSON.Polygon> {
  const bbox = packedTileIdToBBox(tile.tileId);
  const level = packedTileIdToLevel(tile.tileId);
  return {
    type: "Feature",
    properties: {
      tileId: tile.tileId,
      level,
      latestEvent: tile.latestEvent,
      eventCount: tile.events.length,
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

// ── Map instance ─────────────────────────────────────────────────────────────

let map: maplibregl.Map | null = null;
let popup: maplibregl.Popup | null = null;
const SOURCE_ID = "nds-tiles";
const FILL_LAYER_ID = "nds-tiles-fill";
const LINE_LAYER_ID = "nds-tiles-line";

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

    // Click handler for popups
    map!.on("click", FILL_LAYER_ID, (e) => {
      if (!e.features || e.features.length === 0) return;

      const feature = e.features[0];
      const tileId = feature.properties?.tileId as number;
      const tracked = trackedTiles.get(tileId);
      if (!tracked) return;

      const level = feature.properties?.level ?? 0;
      const bbox = packedTileIdToBBox(tileId);
      const centerLng = (bbox.southWest.lng + bbox.northEast.lng) / 2;
      const centerLat = (bbox.southWest.lat + bbox.northEast.lat) / 2;

      // Build popup content
      let html = `<div class="tile-popup">`;
      html += `<div class="tile-popup-header">Tile #${tileId} <span class="tile-popup-level">L${level}</span></div>`;
      html += `<div class="tile-popup-coords">${bbox.southWest.lat.toFixed(4)}°, ${bbox.southWest.lng.toFixed(4)}° → ${bbox.northEast.lat.toFixed(4)}°, ${bbox.northEast.lng.toFixed(4)}°</div>`;
      html += `<div class="tile-popup-events">`;

      // Show last 10 events for this tile
      const recentEvents = tracked.events.slice(-10);
      for (const ev of recentEvents) {
        const time = new Date(ev.time).toLocaleTimeString("en-US", { hour12: false });
        const color = EVENT_COLORS[ev.event] ?? "#6c8cff";
        let meta = "";
        if (ev.sizeBytes) meta += ` · ${(ev.sizeBytes / 1024).toFixed(1)} KB`;
        if (ev.httpCode) meta += ` · HTTP ${ev.httpCode}`;
        html += `<div class="tile-popup-event">
          <span style="color:${color};font-weight:600">${ev.event}</span>
          <span class="tile-popup-cache">${ev.cache}</span>
          <span class="tile-popup-time">${time}${meta}</span>
        </div>`;
      }

      if (tracked.events.length > 10) {
        html += `<div class="tile-popup-more">… and ${tracked.events.length - 10} more</div>`;
      }

      html += `</div></div>`;

      // Remove existing popup
      if (popup) popup.remove();

      popup = new maplibregl.Popup({ closeOnClick: true, maxWidth: "340px" })
        .setLngLat([centerLng, centerLat])
        .setHTML(html)
        .addTo(map!);
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

// ── Public API: add tile events ──────────────────────────────────────────────

export function addTileEventsToMap(events: TileEvent[], time: number): void {
  if (!map) return;

  for (const te of events) {
    const existing = trackedTiles.get(te.tileId);
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
      trackedTiles.set(te.tileId, {
        tileId: te.tileId,
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
  for (const [id, tile] of trackedTiles) {
    if (now - tile.addedAt > TILE_TTL_MS) {
      trackedTiles.delete(id);
    }
  }

  // Enforce max tile limit (remove oldest)
  if (trackedTiles.size > MAX_TILES) {
    const sorted = [...trackedTiles.entries()].sort((a, b) => a[1].addedAt - b[1].addedAt);
    const toRemove = sorted.slice(0, trackedTiles.size - MAX_TILES);
    for (const [id] of toRemove) {
      trackedTiles.delete(id);
    }
  }

  // Update map source
  const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(buildFeatureCollection());
  }
}
