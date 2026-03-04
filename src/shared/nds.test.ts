import { describe, it, expect } from "vitest";
import { lngLatToPackedTileId, packedTileIdToBBox, packedTileIdToLevel } from "./nds";

describe("NDS.Live tiles (regression)", () => {
  it("level 13 round-trips for Madrid", () => {
    const id = lngLatToPackedTileId({ lng: -3.7, lat: 40.4 }, 13);
    expect(packedTileIdToLevel(id)).toBe(13);
    const bbox = packedTileIdToBBox(id);
    expect(bbox.southWest.lng).toBeLessThanOrEqual(-3.7);
    expect(bbox.northEast.lng).toBeGreaterThanOrEqual(-3.7);
    expect(bbox.southWest.lat).toBeLessThanOrEqual(40.4);
    expect(bbox.northEast.lat).toBeGreaterThanOrEqual(40.4);
  });
});
