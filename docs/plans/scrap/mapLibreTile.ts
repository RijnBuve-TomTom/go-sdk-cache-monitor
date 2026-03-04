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

import Wgs84Utils, {LngLat} from "./utils/wgs84Utils"
import Tile from "./tile"

export class MapLibreTile extends Tile {
  protected constructor(level: number, x: number, y: number, northEast: LngLat, southWest: LngLat) {
    super(level, x, y, northEast, southWest)
  }

  public static fromXY(level: number, x: number, y: number) {
    const resolution = 1 << level
    const leftLon = Wgs84Utils.mercatorToLongitude(x / resolution)
    const rightLon = Wgs84Utils.mercatorToLongitude((x + 1) / resolution)
    const topLat = Wgs84Utils.mercatorToLatitude(y / resolution)
    const bottomLat = Wgs84Utils.mercatorToLatitude((y + 1) / resolution)
    const southWest = {lng: leftLon, lat: bottomLat}
    const northEast = {lng: rightLon, lat: topLat}
    return new MapLibreTile(level, x, y, northEast, southWest)
  }

  public static fromCoordinate(level: number, coordinate: LngLat): MapLibreTile {
    const resolution = 1 << level
    const x = Math.floor(Wgs84Utils.longitudeToMercator(coordinate.lng) * resolution)
    const y = Math.floor(Wgs84Utils.latitudeToMercator(coordinate.lat) * resolution)
    return MapLibreTile.fromXY(level, x, y)
  }

  public readonly maxX = (level: number) => 1 << (level + 1)
  public readonly maxY = (level: number) => 1 << level
}

export default MapLibreTile
