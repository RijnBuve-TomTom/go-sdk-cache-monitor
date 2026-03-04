import { describe, it, expect } from "vitest";
import {
  packNavTileId,
  unpackNavTileId,
  navTileIdToLevel,
  navTileIdToBBox,
  lngLatToNavTileId,
} from "./navtile";

describe("packNavTileId / unpackNavTileId", () => {
  it("round-trips level, x, y correctly", () => {
    const id = packNavTileId(13, 4050, 2025);
    const { level, x, y } = unpackNavTileId(id);
    expect(level).toBe(13);
    expect(x).toBe(4050);
    expect(y).toBe(2025);
  });

  it("handles level 0", () => {
    const id = packNavTileId(0, 0, 0);
    const { level, x, y } = unpackNavTileId(id);
    expect(level).toBe(0);
    expect(x).toBe(0);
    expect(y).toBe(0);
  });

  it("handles max values for level 15", () => {
    const id = packNavTileId(15, 4095, 4095);
    const { level, x, y } = unpackNavTileId(id);
    expect(level).toBe(15);
    expect(x).toBe(4095);
    expect(y).toBe(4095);
  });
});

describe("navTileIdToLevel", () => {
  it("extracts level from packed ID", () => {
    const id = packNavTileId(12, 100, 50);
    expect(navTileIdToLevel(id)).toBe(12);
  });
});

describe("navTileIdToBBox", () => {
  it("returns correct bbox for level 0 tile (0,0) — full world", () => {
    const id = packNavTileId(0, 0, 0);
    const bbox = navTileIdToBBox(id);
    // Level 0: sizeX=2, sizeY=1 → degreesX=180, degreesY=180
    expect(bbox.southWest.lng).toBeCloseTo(-180);
    expect(bbox.northEast.lng).toBeCloseTo(0);
    expect(bbox.northWest.lat).toBeCloseTo(90);
    expect(bbox.southWest.lat).toBeCloseTo(-90);
  });

  it("returns correct bbox for level 13 tile near Madrid", () => {
    // Madrid: ~(-3.7, 40.4)
    const id = lngLatToNavTileId({ lng: -3.7, lat: 40.4 }, 13);
    const bbox = navTileIdToBBox(id);
    // Tile should contain Madrid
    expect(bbox.southWest.lng).toBeLessThanOrEqual(-3.7);
    expect(bbox.northEast.lng).toBeGreaterThanOrEqual(-3.7);
    expect(bbox.southWest.lat).toBeLessThanOrEqual(40.4);
    expect(bbox.northEast.lat).toBeGreaterThanOrEqual(40.4);
  });

  it("north pole is at top (y=0)", () => {
    const id = packNavTileId(1, 0, 0);
    const bbox = navTileIdToBBox(id);
    expect(bbox.northWest.lat).toBeCloseTo(90);
  });
});

describe("lngLatToNavTileId", () => {
  it("round-trips: encode then decode bbox contains original point", () => {
    const lng = 5.5;
    const lat = 52.3;
    const level = 13;
    const id = lngLatToNavTileId({ lng, lat }, level);
    const bbox = navTileIdToBBox(id);
    expect(bbox.southWest.lng).toBeLessThanOrEqual(lng);
    expect(bbox.northEast.lng).toBeGreaterThanOrEqual(lng);
    expect(bbox.southWest.lat).toBeLessThanOrEqual(lat);
    expect(bbox.northEast.lat).toBeGreaterThanOrEqual(lat);
  });

  it("clamps out-of-range coordinates", () => {
    // Should not throw for edge coordinates
    const id1 = lngLatToNavTileId({ lng: -180, lat: 90 }, 13);
    const id2 = lngLatToNavTileId({ lng: 179.99, lat: -89.99 }, 13);
    expect(navTileIdToLevel(id1)).toBe(13);
    expect(navTileIdToLevel(id2)).toBe(13);
  });

  it("preserves level in packed ID", () => {
    for (const level of [7, 10, 11, 12, 13]) {
      const id = lngLatToNavTileId({ lng: 0, lat: 0 }, level);
      expect(navTileIdToLevel(id)).toBe(level);
    }
  });
});
