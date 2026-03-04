### Analysis & Implementation Plan

Below is a detailed breakdown of what needs to change across the codebase to meet all requirements.

---

### The Two Tiling Schemes

#### NDS.Live Tiles (Morton-coded packed tile IDs)
- Used **only** by the `ndsLive` cache type
- **Always level 13** — this is a hard domain constraint
- Decoded using `src/shared/nds.ts` → `packedTileIdToBBox()` and `packedTileIdToLevel()`
- Uses Morton codes (Z-order curves) to interleave longitude/latitude bits into a single packed integer
- The level is encoded in the high bits of the packed ID (bit position of highest set bit minus 16)

#### NavTiles (equirectangular grid)
- Used by **all other** cache types: `mapVector`, `hillshade`, `satellite`, `tile3d`, `trafficFlowVector`, `trafficIncidentVector`, `mapRaster`, etc.
- Can be **different levels** — mostly 12 and 13, very few will be <12 but it does happen
- Tiling scheme from `docs/plans/scrap/navTile.ts`:

```typescript
// NavTile bounding box from (level, x, y):
const sizeX = 1 << (level + 1)    // number of columns
const sizeY = 1 << level           // number of rows
const degreesPerTileUnitX = 360.0 / sizeX
const degreesPerTileUnitY = 180.0 / sizeY

const leftLon  = -180.0 + x * degreesPerTileUnitX
const rightLon = -180.0 + (x + 1) * degreesPerTileUnitX
const topLat   = 90.0 - y * degreesPerTileUnitY
const bottomLat = 90.0 - (y + 1) * degreesPerTileUnitY
```

This is a simple equirectangular (plate carrée) grid, **not** Morton-coded. The grid has `2^(level+1)` columns and `2^level` rows, with `y=0` at the **north pole** (top-left origin).

---

### What Needs to Change

#### 1. New Shared Utility: `src/shared/navtile.ts`

A new module analogous to `shared/nds.ts` that provides:

- **`navTileIdToBBox(tileId: number): TileBoundingBox`** — decodes a packed NavTile ID into a WGS84 bounding box
- **`navTileIdToLevel(tileId: number): number`** — extracts the level from a packed NavTile ID
- **`lngLatToNavTileId(lngLat: LngLat, level: number): number`** — encodes a coordinate at a given level into a packed NavTile ID

The NavTile `tileId` needs a packing scheme to encode `(level, x, y)` into a single number. A reasonable approach:

```typescript
// Pack: level in top bits, then x and y
// At level L: x ranges [0, 2^(L+1)), y ranges [0, 2^L)
// Max level 15 → x up to 65536, y up to 32768
// Packing: tileId = (level << 24) | (x << 12) | y
// This fits in 32 bits for levels up to 15

export function packNavTileId(level: number, x: number, y: number): number {
  return (level << 24) | (x << 12) | y;
}

export function unpackNavTileId(tileId: number): { level: number; x: number; y: number } {
  return {
    level: (tileId >> 24) & 0xFF,
    x: (tileId >> 12) & 0xFFF,
    y: tileId & 0xFFF,
  };
}
```

Then the bounding box calculation follows the `navTile.ts` scrap code directly.

#### 2. Client `src/client/tile-map.ts` — Tile Rendering

Currently, **every tile** is processed through NDS.Live decoding:

```typescript
// Current (BROKEN for non-NDS tiles):
function tileToFeature(tile: TrackedTile): GeoJSON.Feature<GeoJSON.Polygon> {
  const bbox = packedTileIdToBBox(tile.tileId);  // ← always NDS.Live
  const level = packedTileIdToLevel(tile.tileId); // ← always NDS.Live
  ...
}
```

**Must change to**: branch on `cache` type. The `TrackedTile` interface needs to store the `cache` type, and the bbox computation must dispatch:

```typescript
// Pseudocode for the fix:
function tileToFeature(tile: TrackedTile): GeoJSON.Feature<GeoJSON.Polygon> {
  let bbox: TileBoundingBox;
  let level: number;
  
  if (tile.cache === "ndsLive") {
    bbox = packedTileIdToBBox(tile.tileId);
    level = packedTileIdToLevel(tile.tileId);
  } else {
    bbox = navTileIdToBBox(tile.tileId);
    level = navTileIdToLevel(tile.tileId);
  }
  // ... rest unchanged
}
```

The same branching is needed in `buildCrossFeatureCollection()`, `fitMapToTiles()`, and the **click handler**.

The `TrackedTile` interface needs a `cache` field:

```typescript
interface TrackedTile {
  tileId: number;
  cache: string;           // ← ADD THIS
  events: { ... }[];
  latestEvent: TileEventType;
  addedAt: number;
}
```

And `addTileEventsToMap()` must store it when creating new tracked tiles.

#### 3. Client Click Handler — Show Multiple Popups for Overlapping Tiles

Currently only one popup is shown:

```typescript
// Current (line 224-272 of tile-map.ts):
map!.on("click", FILL_LAYER_ID, (e) => {
  if (!e.features || e.features.length === 0) return;
  const feature = e.features[0];  // ← only first feature!
  // ... shows single popup
});
```

**Must change to**: iterate ALL features in `e.features` and show a popup/dialog for each. Since MapLibre only supports one popup at a time with the built-in `Popup` class, you'd need to either:
- Create **multiple `maplibregl.Popup` instances** (one per overlapping tile), offset slightly
- Or build a **single combined popup** listing all overlapping tiles with sections/tabs

The multi-popup approach:

```typescript
map!.on("click", FILL_LAYER_ID, (e) => {
  if (!e.features || e.features.length === 0) return;
  
  // Remove all existing popups
  activePopups.forEach(p => p.remove());
  activePopups = [];
  
  for (const feature of e.features) {
    const tileId = feature.properties?.tileId as number;
    const tracked = trackedTiles.get(tileId);
    if (!tracked) continue;
    
    // Build popup for this tile...
    const popup = new maplibregl.Popup({ ... })
      .setLngLat([centerLng, centerLat + offsetForIndex])
      .setHTML(html)
      .addTo(map!);
    activePopups.push(popup);
  }
});
```

#### 4. Demo Server `src/server/demo.ts` — Realistic Mixed Tile Generation

Currently generates **only** NDS.Live level-13 tiles for all cache types:

```typescript
// Current (BROKEN):
const TILE_LEVEL = 13;
function generateNdsTileId(): number {
  // ... uses lngLatToPackedTileId at level 13 for ALL caches
}
```

**Must change to**:
- For `ndsLive` cache: continue generating NDS.Live packed tile IDs at **level 13 only**
- For all other caches: generate NavTile IDs at **varying levels** (mostly 12-13, occasionally <12)

```typescript
// For non-NDS caches:
function generateNavTileId(level: number): number {
  const city = pick(CITY_CENTERS);
  const lng = city.lng + (Math.random() - 0.5) * 0.4;
  const lat = city.lat + (Math.random() - 0.5) * 0.4;
  return lngLatToNavTileId({ lng, lat }, level);
}

function pickNonNdsLevel(): number {
  const r = Math.random();
  if (r < 0.45) return 13;      // 45% level 13
  if (r < 0.90) return 12;      // 45% level 12
  if (r < 0.95) return 11;      // 5% level 11
  if (r < 0.98) return 10;      // 3% level 10
  return randInt(7, 9);          // 2% levels 7-9 (rare)
}

function generateTileBatch(): TileBatchMessage {
  // ...
  for (let i = 0; i < count; i++) {
    const cache = pick(ACTIVE_CACHES);
    const event = weightedEvent();
    
    let tileId: number;
    if (cache === "ndsLive") {
      tileId = generateNdsTileId();        // NDS.Live, always level 13
    } else {
      const level = pickNonNdsLevel();
      tileId = generateNavTileId(level);   // NavTile, variable levels
    }
    // ...
  }
}
```

This ensures overlapping tiles happen naturally — NDS.Live level-13 tiles and NavTile level-12/13 tiles around the same city center will overlap geographically.

#### 5. Tracking Tiles — Composite Key

Currently tiles are tracked by `tileId` alone:

```typescript
const trackedTiles: Map<number, TrackedTile> = new Map();
```

Since NDS.Live and NavTile IDs can collide (same number, different meaning), the map key should be a **composite of cache type + tileId**:

```typescript
// Use "cacheType:tileId" as the key
const trackedTiles: Map<string, TrackedTile> = new Map();

function tileKey(cache: string, tileId: number): string {
  return `${cache}:${tileId}`;
}
```

---

### Summary of Files to Modify

| File | Change |
|---|---|
| **`src/shared/navtile.ts`** | **NEW** — NavTile packing/unpacking, bounding box computation |
| **`src/shared/nds.ts`** | No change (already correct for NDS.Live) |
| **`src/client/tile-map.ts`** | Branch on cache type for bbox decoding; composite tile keys; multi-popup click handler |
| **`src/server/demo.ts`** | Generate NDS.Live IDs only for `ndsLive` cache; NavTile IDs at varied levels for others |
| **`src/shared/types.ts`** | No structural change needed (the `TileEvent.cache` field already identifies the cache type) |

### Key Domain Rules

- **NDS.Live tiles are ALWAYS level 13** — enforced in both demo generation and display
- **NavTiles can be different levels** — mostly 12-13, rarely <12
- **NDS.Live and NavTiles can overlap geographically** — clicking an overlap area must show popups for ALL tiles
- **Different zoom level tiles can also overlap** — e.g., a level-12 NavTile covers 4× the area of a level-13 NavTile
- Only `ndsLive` cache type → NDS.Live decoding (`shared/nds.ts`). Every other `CacheType` → NavTile decoding (new `shared/navtile.ts`)
