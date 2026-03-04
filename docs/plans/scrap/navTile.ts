/*
 * Copyright 2025 TomTom NV. All rights reserved.
 *
 * This software is the proprietary copyright of TomTom NV and its subsidiaries and may be
 * used for internal evaluation purposes or commercial use strictly subject to separate
 * license agreement between you and TomTom NV. If you are the licensee, you are only permitted
 * to use this software in accordance with the terms of your license agreement. If you are
 * not the licensee, you are not authorized to use this software in any manner and should
 * immediately return or destroy it.
 */

import {LngLat} from "./utils/wgs84Utils"
import Tile from "./tile"

export class NavTile extends Tile {
  protected constructor(level: number, x: number, y: number, northEast: LngLat, southWest: LngLat) {
    super(level, x, y, northEast, southWest)
  }

  public static fromXY(level: number, x: number, y: number) {
    const sizeX = 1 << (level + 1)
    const sizeY = 1 << level
    const degreesPerTileUnitX = 360.0 / sizeX
    const degreesPerTileUnitY = 180.0 / sizeY

    const leftLon = -180.0 + x * degreesPerTileUnitX
    const rightLon = -180.0 + (x + 1) * degreesPerTileUnitX
    const topLat = 90.0 - y * degreesPerTileUnitY
    const bottomLat = 90.0 - (y + 1) * degreesPerTileUnitY
    const northEast: LngLat = {lng: rightLon, lat: topLat}
    const southWest: LngLat = {lng: leftLon, lat: bottomLat}
    return new NavTile(level, x, y, northEast, southWest)
  }
}

export default NavTile
