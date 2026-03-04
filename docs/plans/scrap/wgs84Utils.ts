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

export type LngLat = {
  lng: number
  lat: number
}

/**
 * This is a utility class with static functions only.
 */
export class Wgs84Utils {
  private static readonly radiusEarthInMeters = 6378137

  static LngLatToArray(lngLat: LngLat): [number, number] {
    return [lngLat.lng, lngLat.lat]
  }

  /**
   * Calculate the midpoint between two points.
   * @param start Start point.
   * @param end End point.
   * @returns The midpoint between the two points.
   */
  static midPoint(start: LngLat, end: LngLat): LngLat {
    return {
      lng: (start.lng + end.lng) / 2,
      lat: (start.lat + end.lat) / 2
    }
  }

  /**
   * Map a number to a longitude value.
   * @param value The value to map.
   * @returns The mapped longitude value.
   */
  static mapToLon(value: number) {
    return ((((value >= 0 ? value : -value) + 180) % 360) - 180) * (value >= 0 ? 1.0 : -1.0)
  }

  /**
   * Map a number to a latitude value.
   * @param value The value to map.
   * @returns The mapped latitude value.
   */
  static mapToLat(value: number) {
    return Math.max(-90, Math.min(90, value))
  }

  static isValidLng(lon: number) {
    return -180 <= lon && lon <= 180
  }

  static isValidLat(lat: number) {
    return -90 <= lat && lat <= 90
  }

  // Mercator values for latitude are in the range of 0 (north) to 1 (south).
  static mercatorToLatitude(y: number): number {
    if (Number.isNaN(y) || y === Infinity || y === -Infinity) {
      return NaN
    }
    return (180 / Math.PI) * (2.0 * Math.atan(Math.exp(Math.PI - 2.0 * Math.PI * y)) - Math.PI / 2.0)
  }

  static latitudeToMercator(y: number): number {
    return (1.0 - Math.log(Math.tan((y * Math.PI) / 180.0) + 1.0 / Math.cos((y * Math.PI) / 180.0)) / Math.PI) / 2.0
  }

  // Mercator values for longitude are in the range of 0 (west) to 1 (east).
  static mercatorToLongitude(x: number): number {
    return x * 360 - 180
  }

  static longitudeToMercator(x: number): number {
    return (x + 180) / 360
  }

  static toRadians(degree: number): number {
    return (degree / 180.0) * Math.PI
  }

  static toDegrees(radians: number): number {
    return (radians / Math.PI) * 180.0
  }

  /**
   * Calculate the distance in meters between two points. This is a simple implementation of the Haversine formula
   * which only works well for short distances.
   * @param start The start point.
   * @param end The end point.
   */
  static distanceInMetersShortDistance(start: LngLat, end: LngLat): number {
    const deltaLat = Wgs84Utils.toRadians(end.lat - start.lat)
    const deltaLon = Wgs84Utils.toRadians(end.lng - start.lng)
    const a =
      Math.sin(deltaLat / 2.0) * Math.sin(deltaLat / 2.0) +
      Math.cos(Wgs84Utils.toRadians(start.lat)) *
        Math.cos(Wgs84Utils.toRadians(end.lat)) *
        Math.sin(deltaLon / 2.0) *
        Math.sin(deltaLon / 2.0)
    const c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a))
    return this.radiusEarthInMeters * c
  }

  /**
   * Calculate the distance in meters between two points. This use an iterative approach to calculate the distance
   * which works well also for long distances.
   * @param start The start point.
   * @param end The end point.
   */
  static distanceInMeters(start: LngLat, end: LngLat): number {
    const maxSafeHaversineDistanceInDegrees = 0.0025
    // Calculate distance in short steps to increase accuracy for longer distances.
    const stepsLng = Math.ceil(Math.abs(start.lng - end.lng) / maxSafeHaversineDistanceInDegrees)
    const stepsLat = Math.ceil(Math.abs(start.lat - end.lat) / maxSafeHaversineDistanceInDegrees)
    const steps = Math.max(1, Math.max(stepsLng, stepsLat))
    let totalMeters = 0
    let currentLng = start.lng
    let currentLat = start.lat
    for (let step = 0; step < steps; ++step) {
      const nextLng = currentLng + (end.lng - start.lng) / steps
      const nextLat = currentLat + (end.lat - start.lat) / steps

      totalMeters += Wgs84Utils.distanceInMetersShortDistance(
        {lng: currentLng, lat: currentLat},
        {
          lng: nextLng,
          lat: nextLat
        }
      )
      currentLng = nextLng
      currentLat = nextLat
    }
    return totalMeters
  }

  /**
   * Convert meters to degrees of latitude.
   * @param meters Distance in meters.
   * @returns Distance in degrees of latitude.
   */
  static metersToLatitudeDegrees(meters: number): number {
    return (meters / Wgs84Utils.radiusEarthInMeters) * (180 / Math.PI)
  }

  /**
   * Convert meters to degrees of longitude at a given latitude.
   * @param meters Distance in meters.
   * @param atLatitude The latitude at which to calculate the longitude degrees.
   * @returns Distance in degrees of longitude.
   */
  static metersToLongitudeDegrees(meters: number, atLatitude: number): number {
    return Wgs84Utils.metersToLatitudeDegrees(meters) / Math.cos((atLatitude * Math.PI) / 180)
  }

  /**
   * Calculate the bearing in degrees from the origin point to the destination point.
   * The bearing is the angle between the north direction and the direction to the destination,
   * measured in degrees clockwise from north.
   * @param origin The starting point.
   * @param destination The ending point.
   * @returns The bearing in degrees (0-360).
   */
  static calculateBearing(origin: LngLat, destination: LngLat): number {
    // Convert latitude and longitude from degrees to radians
    const lat1 = Wgs84Utils.toRadians(origin.lat)
    const lat2 = Wgs84Utils.toRadians(destination.lat)
    const deltaLon = Wgs84Utils.toRadians(destination.lng - origin.lng)

    // Calculate the bearing using the formula
    const y = Math.sin(deltaLon) * Math.cos(lat2)
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon)
    let bearing = Math.atan2(y, x)

    // Convert from radians to degrees
    bearing = Wgs84Utils.toDegrees(bearing)

    // Normalize to 0-360 degrees
    return (bearing + 360) % 360
  }
}

export default Wgs84Utils
