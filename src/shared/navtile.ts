// ── NavTile ID Utilities ─────────────────────────────────────────────────────
// Converts NavTile packed tile IDs to WGS84 bounding boxes.
// NavTiles use a simple equirectangular (plate carrée) grid:
//   - 2^(level+1) columns (x), 2^level rows (y)
//   - y=0 at north pole (top-left origin)

import type { LngLat, TileBoundingBox } from "./nds.js";

/**
 * Pack (level, x, y) into a single NavTile ID.
 *
 * At level L, x ranges [0, 2^(L+1)) and y ranges [0, 2^L).
 * Max level 15 → x up to 65535 (16 bits), y up to 32767 (15 bits).
 * We reserve 16 bits for y and 17 bits for x, plus 8 bits for level.
 * Total ≤ 41 bits, well within JS safe-integer range (2^53).
 *
 * Layout (arithmetic, not bitwise — avoids JS 32-bit limitation):
 *   tileId = level * 2^33 + x * 2^16 + y
 */
const X_SHIFT = 65536;          // 2^16 — room for y
const LEVEL_SHIFT = 8589934592; // 2^33 — room for x (17 bits) + y (16 bits)

export function packNavTileId(level: number, x: number, y: number): number {
  return level * LEVEL_SHIFT + x * X_SHIFT + y;
}

/**
 * Unpack a NavTile ID into (level, x, y).
 */
export function unpackNavTileId(tileId: number): { level: number; x: number; y: number } {
  const level = Math.floor(tileId / LEVEL_SHIFT);
  const remainder = tileId - level * LEVEL_SHIFT;
  const x = Math.floor(remainder / X_SHIFT);
  const y = remainder - x * X_SHIFT;
  return { level, x, y };
}

/**
 * Extract the level from a packed NavTile ID.
 */
export function navTileIdToLevel(tileId: number): number {
  return Math.floor(tileId / LEVEL_SHIFT);
}

/**
 * Convert a packed NavTile ID to a WGS84 bounding box.
 *
 * Grid geometry (from scrap/navTile.ts):
 *   sizeX = 2^(level+1)   — number of columns
 *   sizeY = 2^level        — number of rows
 *   degreesPerTileX = 360 / sizeX
 *   degreesPerTileY = 180 / sizeY
 *   leftLon  = -180 + x * degreesPerTileX
 *   rightLon = -180 + (x+1) * degreesPerTileX
 *   topLat   = 90 - y * degreesPerTileY
 *   bottomLat = 90 - (y+1) * degreesPerTileY
 */
export function navTileIdToBBox(tileId: number): TileBoundingBox {
  const { level, x, y } = unpackNavTileId(tileId);

  const sizeX = 1 << (level + 1);
  const sizeY = 1 << level;
  const degreesPerTileX = 360.0 / sizeX;
  const degreesPerTileY = 180.0 / sizeY;

  const leftLon = -180.0 + x * degreesPerTileX;
  const rightLon = -180.0 + (x + 1) * degreesPerTileX;
  const topLat = 90.0 - y * degreesPerTileY;
  const bottomLat = 90.0 - (y + 1) * degreesPerTileY;

  return {
    southWest: { lng: leftLon, lat: bottomLat },
    southEast: { lng: rightLon, lat: bottomLat },
    northEast: { lng: rightLon, lat: topLat },
    northWest: { lng: leftLon, lat: topLat },
  };
}

/**
 * Convert a lng/lat coordinate to a packed NavTile ID at the given level.
 */
export function lngLatToNavTileId(lngLat: LngLat, level: number): number {
  const sizeX = 1 << (level + 1);
  const sizeY = 1 << level;
  const degreesPerTileX = 360.0 / sizeX;
  const degreesPerTileY = 180.0 / sizeY;

  const x = Math.floor((lngLat.lng + 180.0) / degreesPerTileX);
  const y = Math.floor((90.0 - lngLat.lat) / degreesPerTileY);

  // Clamp to valid range
  const clampedX = Math.max(0, Math.min(sizeX - 1, x));
  const clampedY = Math.max(0, Math.min(sizeY - 1, y));

  return packNavTileId(level, clampedX, clampedY);
}
