# 🗺️ Cache Monitor

A real-time visual cache monitor for Android navigation apps. Connects via ADB to `logcat`, parses `CacheMonitor` tagged messages, and displays tile events, cache statistics, and alerts in a live dashboard.

![Architecture: Node.js backend + Browser frontend](https://img.shields.io/badge/Stack-Node.js%20%2B%20Vite%20%2B%20Chart.js-blue)

## Features

- **Live tile event feed** — real-time scrolling list of hits, misses, downloads, evictions, and more
- **Event rate chart** — line chart showing events/second by type over the last 60 seconds
- **Hit ratio chart** — horizontal bar chart showing cache hit ratios per cache type
- **Cache statistics cards** — detailed per-cache stats with disk usage bars
- **Floating stats window** — draggable, minimizable summary table with aggregated metrics
- **Toast alerts** — immediate notifications for flush and corruption events
- **Auto-reconnect** — both ADB and WebSocket connections auto-reconnect on failure
- **Demo mode** — built-in fake data generator for UI development without a device

## Architecture

```
┌──────────────────┐      ┌──────────────────────────────────┐
│  Android Device  │      │         Node.js Server           │
│                  │      │                                  │
│  CacheMonitor    │─adb─▶│  adb logcat -s CacheMonitor*:D   │
│  (logcat output) │      │       ↓ parse JSON               │
│                  │      │  WebSocket broadcast ──────────┐ │
└──────────────────┘      └──────────────────────────────────┘
                                                           │
                            ┌──────────────────────────────┘
                            ▼
                   ┌──────────────────────────────────┐
                   │       Browser Dashboard          │
                   │                                  │
                   │  ┌──────┬────────┬────────────┐  │
                   │  │ Tile │ Charts │   Cache    │  │
                   │  │ Feed │        │   Stats    │  │
                   │  └──────┴────────┴────────────┘  │
                   │            ┌────────────┐        │
                   │            │  Floating  │        │
                   │            │   Stats    │        │
                   │            └────────────┘        │
                   └──────────────────────────────────┘
```

## Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **ADB** installed and in PATH (for real device mode)
- An Android device running a navigation app with CacheMonitor enabled

### Install

```bash
npm install
```

### Demo Mode (no device needed)

Start the demo server which generates realistic fake data:

```bash
# Terminal 1: Start demo backend (port 3001)
npm run demo

# Terminal 2: Start Vite dev server (port 5173)
npm run dev:client
```

Open **http://localhost:5173** in your browser.

### Real Device Mode

Connect your Android device via USB/WiFi and ensure `adb devices` shows it.

```bash
# Terminal 1: Start server with ADB bridge (port 3001)
npm run dev:server

# Terminal 2: Start Vite dev server (port 5173)
npm run dev:client
```

Or run both concurrently:

```bash
npm run dev
```

Open **http://localhost:5173** in your browser.

## Message Format

The app parses three types of JSON messages from logcat (tag: `CacheMonitor`):

| Message Type | Interval | Description |
|---|---|---|
| `tileBatch` | 250ms | Batched tile-level events (hit, miss, download, evict, etc.) |
| `cacheStats` | 15s | Cumulative statistics per cache type |
| `cacheEvent` | Immediate | One-off events (flush, corruption) |

### Supported Cache Types

`ndsLive`, `mapVector`, `hillshade`, `satellite`, `tile3d`, `trafficIncidentVector`, `trafficFlowVector`, `mapRaster`, `trafficIncidentRaster`, `trafficFlowRaster`, `extendedMapVector`, `extendedTrafficIncident`, `extendedTrafficFlow`, `deltaExtendedMap`, `compressedHillshade`, `mapDataStore`, `other`

### Supported Tile Events

`hit`, `miss`, `expiredHit`, `download`, `evict`, `flush`, `corruption`, `update`

## Project Structure

```
src/
├── shared/
│   └── types.ts          # Shared TypeScript types (message formats, enums)
├── server/
│   ├── index.ts          # Production server (ADB + WebSocket)
│   ├── adb-bridge.ts     # ADB logcat process management
│   ├── logcat-parser.ts  # Logcat line → JSON parser
│   └── demo.ts           # Demo server with fake data generator
└── client/
    ├── index.html        # Dashboard HTML
    ├── styles.css         # Dark theme styles
    └── main.ts           # Dashboard logic (WebSocket, Chart.js, DOM)
```

## Tech Stack

- **Backend:** Node.js, `ws` (WebSocket), `child_process` (ADB)
- **Frontend:** Vanilla TypeScript, Chart.js, CSS Grid
- **Build:** Vite, TypeScript
- **Dev:** `tsx` (watch mode), `concurrently`
