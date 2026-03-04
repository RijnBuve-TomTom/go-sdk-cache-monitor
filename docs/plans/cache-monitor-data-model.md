### Cache Monitor Data Model

The data model for the cache monitor is located in the `telemetry/cache-monitor` module, specifically in the `model` package:

```
telemetry/cache-monitor/src/commonMain/kotlin/com/tomtom/sdk/telemetry/cachemonitor/model/
```

All messages are written as **single-line JSON** to Android logcat via `Log.d` with the tag **`CacheMonitor`** and **`CacheMonitorIntegration`**. You can filter for them with:

```bash
adb logcat -s CacheMonitor:D CacheMonitorIntegration:D
```

The serialization/output logic lives in `CacheMonitorOutput.kt`.

---

### Four Message Types (`CacheEventMessage`)

The cache monitor emits exactly **four types of JSON messages**, defined as a sealed class in `CacheEventMessage.kt`:

---

#### 1. `tileBatch` — Batched tile-level events (every **250ms** when events exist)

Example JSON structure:
```json
{
    "type": "tileBatch",
    "time": 1709478000000,
    "events": [
        {
            "cache": "ndsLive",
            "tileId": 12345,
            "event": "hit",
            "sizeBytes": 4096,
            "httpCode": 200,
            "trigger": "alongRoute",
            "ageSeconds": 120.5
        }
    ]
}
```

Each event in the batch is a `TileEvent` with:
- `cache` — the cache type (see below)
- `tileId` — raw packed tile identifier
- `event` — the tile event type (see below)
- `sizeBytes` — size in bytes (for downloads, omitted if null)
- `httpCode` — HTTP status code (for downloads, omitted if null)
- `trigger` — request trigger reason, e.g. `"alongRoute"` (omitted if null)
- `ageSeconds` — tile age in seconds (for evictions/accesses, omitted if null)

---

#### 2. `cacheStats` — Rolling cumulative statistics per cache type (every **15 seconds**)

Example JSON structure:
```json
{
    "type": "cacheStats",
    "time": 1709478000000,
    "caches": {
        "ndsLive": {
            "tileCount": 150,
            "totalRequests": 500,
            "cacheHits": 400,
            "cacheMisses": 100,
            "hitRatio": 0.8,
            "totalDownloadedBytes": 2048000,
            "diskUsedBytes": 1024000,
            "diskConfiguredBytes": 5242880,
            "diskRemainingBytes": 4218880,
            "evictions": 10,
            "averageTileAgeSeconds": 300.5,
            "downloadsAfterEviction": 5,
            "flushes": 0,
            "corruptions": 0,
            "totalUploadedBytes": 0
        }
    }
}
```

`CacheStatistics` fields:
- `tileCount` — number of tiles in the cache
- `totalRequests` — cumulative requests since monitoring started
- `cacheHits` / `cacheMisses` — cumulative counts
- `hitRatio` — computed: `cacheHits / totalRequests` (0.0–1.0)
- `totalDownloadedBytes` — cumulative bytes downloaded
- `diskUsedBytes` / `diskConfiguredBytes` — instantaneous (last reported)
- `diskRemainingBytes` — computed: `diskConfiguredBytes - diskUsedBytes`
- `evictions` — cumulative eviction count
- `averageTileAgeSeconds` — incremental average age of evicted tiles
- `downloadsAfterEviction` — cumulative re-downloads after eviction
- `flushes` / `corruptions` — cumulative counts
- `totalUploadedBytes` — cumulative bytes uploaded

---

#### 3. `cacheEvent` — Immediate one-off event notification (flush, corruption)

Example JSON structure:
```json
{
    "type": "cacheEvent",
    "time": 1709478000000,
    "cache": "ndsLive",
    "event": "flush",
    "reason": "userRequested",
    "tilesFlushed": 150,
    "bytesFlushed": 1024000
}
```

Fields:
- `cache` — the cache type
- `event` — the event type
- `reason` — optional reason string (omitted if null)
- `tilesFlushed` — optional count (omitted if null)
- `bytesFlushed` — optional byte count (omitted if null)

---

#### 4. `lifecycleEvent` — Cache monitor lifecycle transitions (tag: `CacheMonitorIntegration`)

Example JSON structure:
```json
{
    "type": "lifecycleEvent",
    "time": 1709478000000,
    "event": "started"
}
```

Fields:
- `event` — the lifecycle event: `"started"` or `"stopped"`
- `time` — Unix timestamp in milliseconds

This message is emitted by the `CacheMonitorIntegration` wrapper in the demo app
with the logcat tag **`CacheMonitorIntegration`** (not `CacheMonitor`).

---

### `TileEventType` (enum)

Defined in `TileEventType.kt`, the possible event types are:

| Enum Value | JSON Value | Description |
|---|---|---|
| `HIT` | `"hit"` | Tile found in cache |
| `MISS` | `"miss"` | Tile not found in cache |
| `EXPIRED_HIT` | `"expiredHit"` | Tile found but expired |
| `DOWNLOAD` | `"download"` | Tile downloaded from server |
| `EVICT` | `"evict"` | Tile evicted from cache |
| `FLUSH` | `"flush"` | Cache flushed |
| `CORRUPTION` | `"corruption"` | Corruption detected |
| `UPDATE` | `"update"` | Tile updated |

---

### `CacheType` (enum)

Defined in `CacheType.kt`, the possible cache types are:

| Enum Value | JSON Value |
|---|---|
| `NDS_LIVE` | `"ndsLive"` |
| `MAP_VECTOR` | `"mapVector"` |
| `HILLSHADE` | `"hillshade"` |
| `SATELLITE` | `"satellite"` |
| `TILE_3D` | `"tile3d"` |
| `TRAFFIC_INCIDENT_VECTOR` | `"trafficIncidentVector"` |
| `TRAFFIC_FLOW_VECTOR` | `"trafficFlowVector"` |
| `MAP_RASTER` | `"mapRaster"` |
| `TRAFFIC_INCIDENT_RASTER` | `"trafficIncidentRaster"` |
| `TRAFFIC_FLOW_RASTER` | `"trafficFlowRaster"` |
| `EXTENDED_MAP_VECTOR` | `"extendedMapVector"` |
| `EXTENDED_TRAFFIC_INCIDENT` | `"extendedTrafficIncident"` |
| `EXTENDED_TRAFFIC_FLOW` | `"extendedTrafficFlow"` |
| `DELTA_EXTENDED_MAP` | `"deltaExtendedMap"` |
| `COMPRESSED_HILLSHADE` | `"compressedHillshade"` |
| `MAP_DATA_STORE` | `"mapDataStore"` |
| `OTHER` | `"other"` |

---

### Emission Intervals Summary

| Message Type | Default Interval | Condition |
|---|---|---|
| `tileBatch` | 250ms | Only emitted when there are buffered events |
| `cacheStats` | 15,000ms (15s) | Only emitted when at least one cache has data |
| `cacheEvent` | Immediate | Emitted instantly for significant one-off events |
| `lifecycleEvent` | Immediate | Emitted on cache monitor start and stop |

Note: The `CacheMonitor` constructor in `CacheMonitor.kt` allows overriding `batchIntervalMs` and `statsIntervalMs` for testing purposes. The `CacheMonitorIntegration` wrapper in the demo app logs structured JSON `lifecycleEvent` messages with the tag `CacheMonitorIntegration` when the cache monitor is started or stopped.
