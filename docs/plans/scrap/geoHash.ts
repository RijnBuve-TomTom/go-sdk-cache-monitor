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

import assert from "./assert"
import MathUtils from "./utils/mathUtils"
import {LngLat} from "./utils/wgs84Utils"

/**
 * This class represents a GeoHash value. It's easy to quickly compare two GeoHash values.
 */
class GeoHash {
  private static readonly NUMBER_OF_BITS = 30
  private static readonly digits = "0123456789abcdefghijklmnopqrstuvwxyz"
  private static readonly lookup: Map<string, number> = new Map()

  private readonly hash: string
  private readonly point: LngLat

  static {
    for (let i = 0; i < GeoHash.digits.length; i++) {
      GeoHash.lookup.set(GeoHash.digits[i], i)
    }
  }

  constructor(arg: string | LngLat) {
    assert(arg, "Argument cannot be nullish")
    if (typeof arg === "string") {
      this.hash = arg
      this.point = GeoHash.decode(arg)
    } else {
      assert(
        arg.lat !== undefined && arg.lng !== undefined && arg.lat !== null && arg.lng !== null,
        "LngLat cannot be null or undefined"
      )
      this.point = arg
      this.hash = GeoHash.encode(arg)
    }
  }

  public static encode(point: LngLat): string {
    return GeoHash.encodeCoordinates(point.lat, point.lng)
  }

  public static encodeCoordinates(lat: number, lng: number): string {
    const latBits = GeoHash.getBits(lat, -90.0, 90.0)
    const lngBits = GeoHash.getBits(lng, -180.0, 180.0)
    let code = ""
    for (let i = 0; i < GeoHash.NUMBER_OF_BITS; i++) {
      code += (lngBits[i] ? "1" : "0") + (latBits[i] ? "1" : "0")
    }
    return GeoHash.base32(parseInt(code, 2))
  }

  public static decode(hash: string): LngLat {
    assert(GeoHash.isValid(hash), "Invalid GeoHash value")

    let code = ""
    for (const c of hash) {
      const i = GeoHash.lookup.get(c)! + 32
      code += i.toString(2).substring(1)
    }

    const lngSet = Array(GeoHash.NUMBER_OF_BITS).fill(false)
    const latSet = Array(GeoHash.NUMBER_OF_BITS).fill(false)

    // Even bits.
    for (let i = 0, j = 0; i < GeoHash.NUMBER_OF_BITS * 2; i += 2) {
      lngSet[j++] = i < code.length && code.charAt(i) === "1"
    }

    // Odd bits.
    for (let i = 1, j = 0; i < GeoHash.NUMBER_OF_BITS * 2; i += 2) {
      latSet[j++] = i < code.length && code.charAt(i) === "1"
    }

    const lng = GeoHash.decodeBits(lngSet, -180.0, 180.0)
    const lat = GeoHash.decodeBits(latSet, -90.0, 90.0)

    return {lat: lat, lng: lng}
  }

  public static isValid(hash: string): boolean {
    if (!hash) {
      return false
    }
    for (const c of hash) {
      if (!GeoHash.lookup.has(c)) {
        return false
      }
    }
    return true
  }

  private static decodeBits(bitSet: boolean[], min: number, max: number): number {
    let floor = min
    let ceil = max
    let mid = 0
    for (const element of bitSet) {
      mid = (floor + ceil) / 2
      if (element) {
        floor = mid
      } else {
        ceil = mid
      }
    }
    return mid
  }

  private static getBits(degrees: number, min: number, max: number): boolean[] {
    const bitSet = Array(GeoHash.NUMBER_OF_BITS).fill(false)
    let floor = min
    let ceil = max
    for (let i = 0; i < GeoHash.NUMBER_OF_BITS; i++) {
      const mid = (floor + ceil) / 2
      if (degrees >= mid) {
        bitSet[i] = true
        floor = mid
      } else {
        ceil = mid
      }
    }
    return bitSet
  }

  private static base32(value: number): string {
    let nr = value
    const buf: string[] = new Array(65)
    let charPos = 64
    const negative = nr < 0
    if (!negative) {
      nr = -nr
    }
    while (nr <= -32) {
      buf[charPos--] = GeoHash.digits.charAt(-(nr % 32))
      nr /= 32
    }
    buf[charPos] = GeoHash.digits.charAt(-nr)

    if (negative) {
      buf[--charPos] = "-"
    }
    return buf.slice(charPos, 65).join("")
  }

  public getHash(): string {
    return this.hash
  }

  public getLngLat(): LngLat {
    return this.point
  }

  public moveTo(point: LngLat): GeoHash {
    const child = GeoHash.encode(point)
    const len = this.hash.length
    return this.setResolutionInternal(child, len)
  }

  public useResolution(other: GeoHash): GeoHash {
    return this.setResolution(other.length())
  }

  public decreaseResolution(amount: number = 1): GeoHash {
    amount = MathUtils.limitValue(amount, 1, this.hash.length - 1)
    return new GeoHash(this.hash.substring(0, this.hash.length - amount))
  }

  public setResolution(length: number): GeoHash {
    return this.setResolutionInternal(this.hash, length)
  }

  public contains(other: GeoHash): boolean {
    return other.hash.startsWith(this.hash)
  }

  public length(): number {
    return this.hash.length
  }

  public equals(other: any): boolean {
    if (this === other) {
      return true
    }
    if (!(other instanceof GeoHash)) {
      return false
    }
    return this.hash === other.hash && this.point.lat === other.point.lat && this.point.lng === other.point.lng
  }

  private setResolutionInternal(hash: string, length: number): GeoHash {
    return new GeoHash(hash.substring(0, Math.min(length, this.hash.length)))
  }
}

export default GeoHash
