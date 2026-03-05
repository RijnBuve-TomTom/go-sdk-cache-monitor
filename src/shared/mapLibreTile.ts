// ── MapLibre Tile ID Utilities ────────────────────────────────────────────────
// Converts MapLibre packed tile IDs to WGS84 bounding boxes.
// MapLibre tiles use a Web Mercator (EPSG:3857) grid:
//   - 2^level columns (x), 2^level rows (y)
//   - y=0 at the top (north), increasing southward

import type { LngLat, TileBoundingBox } from "./nds.js";

// ── Mercator ↔ WGS84 conversion helpers ─────────────────────────────────────

function mercatorToLongitude(x: number): number {
  return x * 360 - 180;
}

function mercatorToLatitude(y: number): number {
  const n = Math.PI * (1 - 2 * y);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

function longitudeToMercator(lng: number): number {
  return (lng + 180) / 360;
}

function latitudeToMercator(lat: number): number {
  const latRad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
}

// ── Packing scheme ───────────────────────────────────────────────────────────

/**
 * Pack (level, x, y) into a single MapLibre tile ID.
 *
 * At level L, x ranges [0, 2^L) and y ranges [0, 2^L).
 * Max level 15 → x up to 32767 (15 bits), y up to 32767 (15 bits).
 * We reserve 16 bits for y and 17 bits for x, plus 8 bits for level.
 * Total ≤ 41 bits, well within JS safe-integer range (2^53).
 *
 * Layout (arithmetic, not bitwise — avoids JS 32-bit limitation):
 *   tileId = level * 2^33 + x * 2^16 + y
 */
const X_SHIFT = 65536;          // 2^16 — room for y
const LEVEL_SHIFT = 8589934592; // 2^33 — room for x (17 bits) + y (16 bits)

export function packMapLibreTileId(level: number, x: number, y: number): number {
  return level * LEVEL_SHIFT + x * X_SHIFT + y;
}

/**
 * Unpack a MapLibre tile ID into (level, x, y).
 */
export function unpackMapLibreTileId(tileId: number): { level: number; x: number; y: number } {
  const level = Math.floor(tileId / LEVEL_SHIFT);
  const remainder = tileId - level * LEVEL_SHIFT;
  const x = Math.floor(remainder / X_SHIFT);
  const y = remainder - x * X_SHIFT;
  return { level, x, y };
}

/**
 * Extract the level from a packed MapLibre tile ID.
 */
export function mapLibreTileIdToLevel(tileId: number): number {
  return Math.floor(tileId / LEVEL_SHIFT);
}

/**
 * Convert a packed MapLibre tile ID to a WGS84 bounding box.
 *
 * Grid geometry (Web Mercator):
 *   resolution = 2^level
 *   leftLon  = mercatorToLongitude(x / resolution)
 *   rightLon = mercatorToLongitude((x + 1) / resolution)
 *   topLat   = mercatorToLatitude(y / resolution)
 *   bottomLat = mercatorToLatitude((y + 1) / resolution)
 */
export function mapLibreTileIdToBBox(tileId: number): TileBoundingBox {
  const { level, x, y } = unpackMapLibreTileId(tileId);

  const resolution = 1 << level;
  const leftLon = mercatorToLongitude(x / resolution);
  const rightLon = mercatorToLongitude((x + 1) / resolution);
  const topLat = mercatorToLatitude(y / resolution);
  const bottomLat = mercatorToLatitude((y + 1) / resolution);

  return {
    southWest: { lng: leftLon, lat: bottomLat },
    southEast: { lng: rightLon, lat: bottomLat },
    northEast: { lng: rightLon, lat: topLat },
    northWest: { lng: leftLon, lat: topLat },
  };
}

/**
 * Convert a lng/lat coordinate to a packed MapLibre tile ID at the given level.
 */
export function lngLatToMapLibreTileId(lngLat: LngLat, level: number): number {
  const resolution = 1 << level;
  const x = Math.floor(longitudeToMercator(lngLat.lng) * resolution);
  const y = Math.floor(latitudeToMercator(lngLat.lat) * resolution);

  // Clamp to valid range
  const maxXY = resolution - 1;
  const clampedX = Math.max(0, Math.min(maxXY, x));
  const clampedY = Math.max(0, Math.min(maxXY, y));

  return packMapLibreTileId(level, clampedX, clampedY);
}
