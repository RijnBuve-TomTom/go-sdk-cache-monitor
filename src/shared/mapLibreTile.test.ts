import { describe, it, expect } from "vitest";
import {
  packMapLibreTileId,
  unpackMapLibreTileId,
  mapLibreTileIdToLevel,
  mapLibreTileIdToBBox,
  lngLatToMapLibreTileId,
} from "./mapLibreTile";

describe("packMapLibreTileId / unpackMapLibreTileId", () => {
  it("round-trips level, x, y correctly", () => {
    const id = packMapLibreTileId(13, 4050, 2025);
    const { level, x, y } = unpackMapLibreTileId(id);
    expect(level).toBe(13);
    expect(x).toBe(4050);
    expect(y).toBe(2025);
  });

  it("handles level 0", () => {
    const id = packMapLibreTileId(0, 0, 0);
    const { level, x, y } = unpackMapLibreTileId(id);
    expect(level).toBe(0);
    expect(x).toBe(0);
    expect(y).toBe(0);
  });

  it("handles max values for level 15", () => {
    const id = packMapLibreTileId(15, 4095, 4095);
    const { level, x, y } = unpackMapLibreTileId(id);
    expect(level).toBe(15);
    expect(x).toBe(4095);
    expect(y).toBe(4095);
  });
});

describe("mapLibreTileIdToLevel", () => {
  it("extracts level from packed ID", () => {
    const id = packMapLibreTileId(12, 100, 50);
    expect(mapLibreTileIdToLevel(id)).toBe(12);
  });
});

describe("mapLibreTileIdToBBox", () => {
  it("returns correct bbox for level 0 tile (0,0) — full world", () => {
    const id = packMapLibreTileId(0, 0, 0);
    const bbox = mapLibreTileIdToBBox(id);
    // Level 0: single tile covers the whole Mercator world
    expect(bbox.southWest.lng).toBeCloseTo(-180);
    expect(bbox.northEast.lng).toBeCloseTo(180);
    // Mercator top/bottom latitudes (~85.051°)
    expect(bbox.northWest.lat).toBeCloseTo(85.051, 0);
    expect(bbox.southWest.lat).toBeCloseTo(-85.051, 0);
  });

  it("returns correct bbox for level 13 tile near Madrid", () => {
    // Madrid: ~(-3.7, 40.4)
    const id = lngLatToMapLibreTileId({ lng: -3.7, lat: 40.4 }, 13);
    const bbox = mapLibreTileIdToBBox(id);
    // Tile should contain Madrid
    expect(bbox.southWest.lng).toBeLessThanOrEqual(-3.7);
    expect(bbox.northEast.lng).toBeGreaterThanOrEqual(-3.7);
    expect(bbox.southWest.lat).toBeLessThanOrEqual(40.4);
    expect(bbox.northEast.lat).toBeGreaterThanOrEqual(40.4);
  });

  it("north is at top (y=0)", () => {
    const id = packMapLibreTileId(1, 0, 0);
    const bbox = mapLibreTileIdToBBox(id);
    // y=0 at level 1: top half of the Mercator world
    expect(bbox.northWest.lat).toBeCloseTo(85.051, 0);
    expect(bbox.southWest.lat).toBeCloseTo(0, 0);
  });

  it("uses Mercator projection (non-uniform latitude spacing)", () => {
    // At level 1, the world is split into 2×2 tiles
    // Top-left tile (0,0) should cover lat ~85° to 0°
    // Bottom-left tile (0,1) should cover lat 0° to ~-85°
    const topId = packMapLibreTileId(1, 0, 0);
    const bottomId = packMapLibreTileId(1, 0, 1);
    const topBbox = mapLibreTileIdToBBox(topId);
    const bottomBbox = mapLibreTileIdToBBox(bottomId);
    expect(topBbox.southWest.lat).toBeCloseTo(0, 0);
    expect(bottomBbox.northWest.lat).toBeCloseTo(0, 0);
    expect(bottomBbox.southWest.lat).toBeCloseTo(-85.051, 0);
  });
});

describe("lngLatToMapLibreTileId", () => {
  it("round-trips: encode then decode bbox contains original point", () => {
    const lng = 5.5;
    const lat = 52.3;
    const level = 13;
    const id = lngLatToMapLibreTileId({ lng, lat }, level);
    const bbox = mapLibreTileIdToBBox(id);
    expect(bbox.southWest.lng).toBeLessThanOrEqual(lng);
    expect(bbox.northEast.lng).toBeGreaterThanOrEqual(lng);
    expect(bbox.southWest.lat).toBeLessThanOrEqual(lat);
    expect(bbox.northEast.lat).toBeGreaterThanOrEqual(lat);
  });

  it("clamps out-of-range coordinates", () => {
    // Should not throw for edge coordinates
    const id1 = lngLatToMapLibreTileId({ lng: -180, lat: 85 }, 13);
    const id2 = lngLatToMapLibreTileId({ lng: 179.99, lat: -85 }, 13);
    expect(mapLibreTileIdToLevel(id1)).toBe(13);
    expect(mapLibreTileIdToLevel(id2)).toBe(13);
  });

  it("preserves level in packed ID", () => {
    for (const level of [7, 10, 11, 12, 13]) {
      const id = lngLatToMapLibreTileId({ lng: 0, lat: 0 }, level);
      expect(mapLibreTileIdToLevel(id)).toBe(level);
    }
  });

  it("handles multiple known locations correctly", () => {
    const locations = [
      { lng: -73.9857, lat: 40.7484 },   // New York
      { lng: 139.6917, lat: 35.6895 },   // Tokyo
      { lng: -43.1729, lat: -22.9068 },  // Rio de Janeiro
      { lng: 151.2093, lat: -33.8688 },  // Sydney
    ];
    for (const loc of locations) {
      const id = lngLatToMapLibreTileId(loc, 14);
      const bbox = mapLibreTileIdToBBox(id);
      expect(bbox.southWest.lng).toBeLessThanOrEqual(loc.lng);
      expect(bbox.northEast.lng).toBeGreaterThanOrEqual(loc.lng);
      expect(bbox.southWest.lat).toBeLessThanOrEqual(loc.lat);
      expect(bbox.northEast.lat).toBeGreaterThanOrEqual(loc.lat);
    }
  });
});
