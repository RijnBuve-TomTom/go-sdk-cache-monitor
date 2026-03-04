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

import {LngLat} from "../common/utils/wgs84Utils"

export class Nds {
  /**
   * Packed Tile IDs
   * level
   * 15     1xxx xxxx xxxx xxxx  xxxx xxxx xxxx xxxx
   * 14     010x xxxx xxxx xxxx  xxxx xxxx xxxx xxxx
   * 13     0010 0xxx xxxx xxxx  xxxx xxxx xxxx xxxx
   *  5     0000 0000 0010 0000  0000 0xxx xxxx xxxx
   *  1     0000 0000 0000 0010  0000 0000 0000 0xxx
   *  0     0000 0000 0000 0001  0000 0000 0000 000x
   */
  private static readonly mortonTable256: number[] = [
    0x0000, 0x0001, 0x0004, 0x0005, 0x0010, 0x0011, 0x0014, 0x0015, 0x0040, 0x0041, 0x0044, 0x0045, 0x0050, 0x0051,
    0x0054, 0x0055, 0x0100, 0x0101, 0x0104, 0x0105, 0x0110, 0x0111, 0x0114, 0x0115, 0x0140, 0x0141, 0x0144, 0x0145,
    0x0150, 0x0151, 0x0154, 0x0155, 0x0400, 0x0401, 0x0404, 0x0405, 0x0410, 0x0411, 0x0414, 0x0415, 0x0440, 0x0441,
    0x0444, 0x0445, 0x0450, 0x0451, 0x0454, 0x0455, 0x0500, 0x0501, 0x0504, 0x0505, 0x0510, 0x0511, 0x0514, 0x0515,
    0x0540, 0x0541, 0x0544, 0x0545, 0x0550, 0x0551, 0x0554, 0x0555, 0x1000, 0x1001, 0x1004, 0x1005, 0x1010, 0x1011,
    0x1014, 0x1015, 0x1040, 0x1041, 0x1044, 0x1045, 0x1050, 0x1051, 0x1054, 0x1055, 0x1100, 0x1101, 0x1104, 0x1105,
    0x1110, 0x1111, 0x1114, 0x1115, 0x1140, 0x1141, 0x1144, 0x1145, 0x1150, 0x1151, 0x1154, 0x1155, 0x1400, 0x1401,
    0x1404, 0x1405, 0x1410, 0x1411, 0x1414, 0x1415, 0x1440, 0x1441, 0x1444, 0x1445, 0x1450, 0x1451, 0x1454, 0x1455,
    0x1500, 0x1501, 0x1504, 0x1505, 0x1510, 0x1511, 0x1514, 0x1515, 0x1540, 0x1541, 0x1544, 0x1545, 0x1550, 0x1551,
    0x1554, 0x1555, 0x4000, 0x4001, 0x4004, 0x4005, 0x4010, 0x4011, 0x4014, 0x4015, 0x4040, 0x4041, 0x4044, 0x4045,
    0x4050, 0x4051, 0x4054, 0x4055, 0x4100, 0x4101, 0x4104, 0x4105, 0x4110, 0x4111, 0x4114, 0x4115, 0x4140, 0x4141,
    0x4144, 0x4145, 0x4150, 0x4151, 0x4154, 0x4155, 0x4400, 0x4401, 0x4404, 0x4405, 0x4410, 0x4411, 0x4414, 0x4415,
    0x4440, 0x4441, 0x4444, 0x4445, 0x4450, 0x4451, 0x4454, 0x4455, 0x4500, 0x4501, 0x4504, 0x4505, 0x4510, 0x4511,
    0x4514, 0x4515, 0x4540, 0x4541, 0x4544, 0x4545, 0x4550, 0x4551, 0x4554, 0x4555, 0x5000, 0x5001, 0x5004, 0x5005,
    0x5010, 0x5011, 0x5014, 0x5015, 0x5040, 0x5041, 0x5044, 0x5045, 0x5050, 0x5051, 0x5054, 0x5055, 0x5100, 0x5101,
    0x5104, 0x5105, 0x5110, 0x5111, 0x5114, 0x5115, 0x5140, 0x5141, 0x5144, 0x5145, 0x5150, 0x5151, 0x5154, 0x5155,
    0x5400, 0x5401, 0x5404, 0x5405, 0x5410, 0x5411, 0x5414, 0x5415, 0x5440, 0x5441, 0x5444, 0x5445, 0x5450, 0x5451,
    0x5454, 0x5455, 0x5500, 0x5501, 0x5504, 0x5505, 0x5510, 0x5511, 0x5514, 0x5515, 0x5540, 0x5541, 0x5544, 0x5545,
    0x5550, 0x5551, 0x5554, 0x5555
  ]

  private static readonly mortonTable16: number[][] = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 0],
    [3, 0],
    [2, 1],
    [3, 1],
    [0, 2],
    [1, 2],
    [0, 3],
    [1, 3],
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3]
  ]

  static trunc(x: number): number {
    return x < 0 ? Math.ceil(x) : Math.floor(x)
  }

  static toUint32(i: number): number {
    return i < 0 ? i + 0x100000000 : i
  }

  public static distanceToLevel(x: number): number {
    return Math.floor(Math.log(180.0 / x) * Math.LOG2E)
  }

  public static levelToDistance(x: number): number {
    return 180.0 / (1 << x)
  }

  /**
   * Coding of NDS longitude:
   * For coding coordinates, a scaling factor is applied so that 360° correspond to 2^32, to exhaust the
   * full range of 32-bit signed integers. In NDS, a coordinate unit corresponds to 90/2^30 degrees of
   * longitude or latitude. Longitudes range between –180° and +180°. Hence, coordinate values are in the
   * range of –2^31 ≤ x < 2^31 for longitudes.
   */
  public static lonToNds(lon: number): number {
    const x = Nds.trunc((lon / 90) * 0x40000000)
    return x >= 0 ? x : x + 0x100000000
  }

  /**
   * Coding of NDS latitude:
   * For coding coordinates, a scaling factor is applied so that 360° correspond to 2^32, to exhaust the
   * full range of 32-bit signed integers. In NDS, a coordinate unit corresponds to 90/2^30 degrees of
   * longitude or latitude. Longitudes range between –180° and +180° and latitudes between –90°
   * and +90°. Hence, coordinate values are in the range of –2^30 ≤ y < 2^30 for latitudes.
   */
  public static latToNds(lat: number): number {
    const y = Nds.trunc((lat / 90) * 0x40000000)
    return y >= 0 ? y : y + 0x80000000
  }

  public static ndsToLon(x: number): number {
    return ((x >= 0x80000000 ? x - 0x100000000 : x) * 90) / 0x40000000
  }

  public static ndsToLat(y: number): number {
    return (90 * (y >= 0x40000000 ? y - 0x80000000 : y)) / 0x40000000
  }

  /**
   * From a coordinate, which is defined by two integer values for longitude (x) and latitude (y), the
   * Morton code can be derived, which is a single number. Thus, two dimensions are mapped into
   * one dimension. To be more precise, for a given coordinate with
   * x = x31 x30...x1 x0 and y = y30...y1 y0 the Morton code c is given by the 63-bit integer
   * c = x31 y30 x30...y1 x1 y0 x0
   * that results from interleaving the bits of the x- and y-coordinate, hence, 0 ≤ c < 263. If stored
   * in a 64-bit integer, the Morton code c is prefixed with a 0 bit, thus always positive.
   */
  public static ndsToMorton(x: number, y: number): number {
    return Nds.toUint32(
      Nds.mortonTable256[x & 0xff] |
        (Nds.mortonTable256[y & 0xff] << 1) |
        (Nds.mortonTable256[(x >> 8) & 0xff] << 16) |
        (Nds.mortonTable256[(y >> 8) & 0xff] << 17)
    )
  }

  public static wgsToMorton(x: number, y: number): number {
    return Nds.ndsToMorton(Nds.lonToNds(x) >> 16, Nds.latToNds(y) >> 16)
  }

  public static packedTileIdToLevel(packedTileId: number): number {
    return Math.floor(Math.log(packedTileId) * Math.LOG2E) - 16
  }

  public static packedTileIdToMorton(packedTileId: number): number {
    const level = Nds.packedTileIdToLevel(packedTileId)
    return (packedTileId & ((1 << (2 * level + 1)) - 1)) << (2 * (15 - level))
  }

  public static packedTileIdToNds(packedTileId: number): {x: number; y: number} {
    let morton = Nds.packedTileIdToMorton(packedTileId)
    let lon = 0
    let lat = 0
    for (let i = 0; i < 8; ++i) {
      const [lonBit, latBit] = Nds.mortonTable16[morton & 0xf]
      lon |= lonBit << (2 * i)
      lat |= latBit << (2 * i)
      morton >>= 4
    }
    return {x: Nds.toUint32(lon << 16), y: Nds.toUint32(lat << 16)}
  }

  public static packedTileIdToWgs(packedTileId: number): {
    southWest: LngLat
    southEast: LngLat
    northEast: LngLat
    northWest: LngLat
  } {
    const nds = Nds.packedTileIdToNds(packedTileId)
    const level = Nds.packedTileIdToLevel(packedTileId)
    const distance = Nds.levelToDistance(level)
    const left = Nds.ndsToLon(nds.x)
    const right = Nds.ndsToLon(nds.x) + distance
    const bottom = level === 0 ? -90.0 : Nds.ndsToLat(nds.y)
    const top = level === 0 ? 90.0 : Nds.ndsToLat(nds.y) + distance
    return {
      southWest: {lng: left, lat: bottom},
      southEast: {lng: right, lat: bottom},
      northEast: {lng: right, lat: top},
      northWest: {lng: left, lat: top}
    }
  }

  /**
   * Converts a LngLat to a packed tile ID at the specified level.
   * @param lngLat The longitude/latitude coordinates.
   * @param level The zoom level.
   * @returns The packed tile ID that contains the given coordinates.
   */
  public static lngLatToPackedTileId(lngLat: LngLat, level: number): number {
    const morton = Nds.wgsToMorton(lngLat.lng, lngLat.lat)
    const shiftedMorton = morton >> (2 * (15 - level))
    return (1 << (level + 16)) | shiftedMorton
  }
}

export default Nds
