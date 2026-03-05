import { Chart, registerables } from "chart.js";
import {
  PROTOCOL_VERSION,
  checkProtocolCompatibility,
} from "../shared/types";
import type {
  CacheMonitorMessage,
  TileBatchMessage,
  CacheStatsMessage,
  CacheEventMessage,
  LifecycleEventMessage,
  CacheStatistics,
  CacheType,
  TileEvent,
  WsEnvelope,
  ServerStatus,
  ProtocolVersion,
} from "../shared/types";
import { initMap, addTileEventsToMap, replayTileEventsToMap, clearApiKey, clearTiles, isAutoZoomEnabled, setAutoZoomEnabled, toggleLevelFilter, onLevelFilterChange, toggleSourceFilter, onSourceFilterChange } from "./tile-map";
import { EventStore } from "./event-store";
import { TimeCursor } from "./time-cursor";
import { TimelineSlider } from "./timeline-slider";

Chart.register(...registerables);

// ── DOM refs ─────────────────────────────────────────────────────────────────

const $badge = document.getElementById("connection-badge")!;
const $deviceId = document.getElementById("device-id")!;
const $msgCounter = document.getElementById("msg-counter")!;
const $evtPerSec = document.getElementById("events-per-sec")!;
const $feedList = document.getElementById("tile-feed-list")!;
const $statsContainer = document.getElementById("cache-stats-container")!;
const $floatingContent = document.getElementById("floating-content")!;
const $floatingBody = document.getElementById("floating-body")!;
const $floatingToggle = document.getElementById("floating-toggle")!;
const $floatingHeader = document.getElementById("floating-header")!;
const $floatingWindow = document.getElementById("floating-stats")!;
const $toastContainer = document.getElementById("toast-container")!;
const $menuBtn = document.getElementById("menu-btn")!;
const $menuDropdown = document.getElementById("menu-dropdown")!;
const $menuClearKey = document.getElementById("menu-clear-key")!;
const $menuClearTiles = document.getElementById("menu-clear-tiles")!;
const $autoZoomToggle = document.getElementById("auto-zoom-toggle")!;

const $timelineTrack = document.getElementById("timeline-slider")!.querySelector(".timeline-track")! as HTMLElement;
const $timelineThumb = document.getElementById("timeline-thumb")!;
const $timelineElapsed = document.getElementById("timeline-elapsed")!;
const $timelineLabelCursor = document.getElementById("timeline-label-cursor")!;
const $goLiveBtn = document.getElementById("timeline-go-live")!;

// ── State ────────────────────────────────────────────────────────────────────

let messageCount = 0;
let totalTileEvents = 0;
const recentEventCounts: number[] = []; // per-second counts for last 60s
let currentSecondCount = 0;

// Cache stats (latest snapshot from cacheStats messages)
const latestStats: Map<CacheType, CacheStatistics> = new Map();

// Event rate history for chart (per event type, last 60 data points)
const RATE_HISTORY_LEN = 60;
const rateHistory: Record<string, number[]> = {
  hit: [],
  miss: [],
  download: [],
  evict: [],
  other: [],
};

// Hit ratio history for chart
const hitRatioHistory: Map<CacheType, number[]> = new Map();

// ── Time machine state ──────────────────────────────────────────────────────

const eventStore = new EventStore();
const EVENT_STORE_MAX_AGE_MS = 120_000; // keep 2 minutes of history

const timeCursor = new TimeCursor((state) => {
  $goLiveBtn.classList.toggle("hidden", state.isLive);
  if (state.isLive) {
    // Resume live: replay all events to rebuild current map state
    rebuildMapFromStore(Infinity);
  } else {
    // Historical: rebuild map up to cursor time
    rebuildMapFromStore(state.time);
  }
});

const timelineSlider = new TimelineSlider(
  {
    track: $timelineTrack,
    thumb: $timelineThumb,
    elapsed: $timelineElapsed,
    labelCursor: $timelineLabelCursor,
  },
  timeCursor,
);

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtAge(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

function fmtPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

// ── Charts ───────────────────────────────────────────────────────────────────

const chartColors: Record<string, string> = {
  hit: "#34d399",
  miss: "#f87171",
  download: "#6c8cff",
  evict: "#fbbf24",
  other: "#a78bfa",
};

const cacheChartColors = [
  "#22d3ee",
  "#34d399",
  "#6c8cff",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#fb923c",
  "#ef4444",
];

const rateChart = new Chart(
  document.getElementById("rate-chart") as HTMLCanvasElement,
  {
    type: "line",
    data: {
      labels: Array.from({ length: RATE_HISTORY_LEN }, (_, i) => `${RATE_HISTORY_LEN - i}s`),
      datasets: Object.entries(chartColors).map(([key, color]) => ({
        label: key,
        data: [],
        borderColor: color,
        backgroundColor: color + "20",
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.3,
        fill: true,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      scales: {
        x: {
          display: true,
          grid: { color: "#2d314830" },
          ticks: { color: "#8b90a5", maxTicksLimit: 10, font: { size: 10 } },
        },
        y: {
          display: true,
          beginAtZero: true,
          grid: { color: "#2d314830" },
          ticks: { color: "#8b90a5", font: { size: 10 } },
        },
      },
      plugins: {
        legend: {
          labels: { color: "#8b90a5", boxWidth: 12, font: { size: 10 } },
        },
      },
    },
  },
);

const hitRatioChart = new Chart(
  document.getElementById("hit-ratio-chart") as HTMLCanvasElement,
  {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "Hit Ratio",
          data: [],
          backgroundColor: [],
          borderColor: [],
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      animation: { duration: 300 },
      scales: {
        x: {
          min: 0,
          max: 1,
          grid: { color: "#2d314830" },
          ticks: {
            color: "#8b90a5",
            callback: (v) => `${(Number(v) * 100).toFixed(0)}%`,
            font: { size: 10 },
          },
        },
        y: {
          grid: { display: false },
          ticks: { color: "#22d3ee", font: { size: 10 } },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  },
);

// ── Per-second rate tracking ─────────────────────────────────────────────────

// Bucket tile events by type for the current second
const currentSecondBuckets: Record<string, number> = {
  hit: 0,
  miss: 0,
  download: 0,
  evict: 0,
  other: 0,
};

function classifyEvent(evt: string): string {
  if (evt === "hit" || evt === "expiredHit") return "hit";
  if (evt === "miss") return "miss";
  if (evt === "download") return "download";
  if (evt === "evict") return "evict";
  return "other";
}

/**
 * Rebuild the map from stored events up to `cutoffMs`.
 * Uses replayTileEventsToMap for efficient single-source-update replay.
 */
function rebuildMapFromStore(cutoffMs: number): void {
  const batches = eventStore.getEventsUpTo(cutoffMs);
  replayTileEventsToMap(batches);
}

setInterval(() => {
  // Push current second's buckets into history
  for (const key of Object.keys(rateHistory)) {
    rateHistory[key].push(currentSecondBuckets[key]);
    if (rateHistory[key].length > RATE_HISTORY_LEN)
      rateHistory[key].shift();
    currentSecondBuckets[key] = 0;
  }

  // Update rate chart
  for (let i = 0; i < rateChart.data.datasets.length; i++) {
    const key = rateChart.data.datasets[i].label!;
    (rateChart.data.datasets[i].data as number[]) = [...rateHistory[key]];
  }
  rateChart.update();

  // Update events/sec display
  recentEventCounts.push(currentSecondCount);
  if (recentEventCounts.length > 5) recentEventCounts.shift();
  const avg =
    recentEventCounts.reduce((a, b) => a + b, 0) / recentEventCounts.length;
  $evtPerSec.textContent = `${avg.toFixed(1)} evt/s`;
  currentSecondCount = 0;

  // Prune old events from the store
  eventStore.prune(Date.now(), EVENT_STORE_MAX_AGE_MS);

  // Tick the timeline slider
  timelineSlider.tick(Date.now());
}, 1000);

// ── Tile feed ────────────────────────────────────────────────────────────────

const MAX_FEED_ITEMS = 200;

function addFeedItem(te: TileEvent, time: number): void {
  const el = document.createElement("div");
  el.className = "feed-item";

  const timeStr = fmtTime(time);
  let meta = "";
  if (te.sizeBytes) meta += fmtBytes(te.sizeBytes);
  if (te.ageSeconds != null) meta += (meta ? " · " : "") + fmtAge(te.ageSeconds);
  if (te.httpCode) meta += (meta ? " · " : "") + `HTTP ${te.httpCode}`;

  el.innerHTML = `
    <span class="feed-time">${timeStr}</span>
    <span class="feed-event" data-event="${te.event}">${te.event}</span>
    <span class="feed-cache" title="${te.cache}:#${te.tileId}">${te.cache}</span>
    <span class="feed-meta">${meta}</span>
  `;

  $feedList.prepend(el);

  // Trim old entries
  while ($feedList.children.length > MAX_FEED_ITEMS) {
    $feedList.removeChild($feedList.lastChild!);
  }
}

// ── Cache stats cards ────────────────────────────────────────────────────────

function renderCacheStats(): void {
  $statsContainer.innerHTML = "";

  const entries = [...latestStats.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  for (const [cache, s] of entries) {
    const diskPct =
      s.diskConfiguredBytes > 0
        ? s.diskUsedBytes / s.diskConfiguredBytes
        : 0;
    const diskColor =
      diskPct > 0.9
        ? "var(--red)"
        : diskPct > 0.7
          ? "var(--orange)"
          : "var(--green)";
    const ratioColor =
      s.hitRatio > 0.7
        ? "var(--green)"
        : s.hitRatio > 0.4
          ? "var(--orange)"
          : "var(--red)";

    const card = document.createElement("div");
    card.className = "cache-card";
    card.innerHTML = `
      <div class="cache-card-header">
        <span class="cache-card-name">${cache}</span>
        <span class="cache-card-ratio" style="color:${ratioColor}">${fmtPct(s.hitRatio)}</span>
      </div>
      <dl class="cache-card-grid">
        <dt>Tiles</dt><dd>${fmtNum(s.tileCount)}</dd>
        <dt>Requests</dt><dd>${fmtNum(s.totalRequests)}</dd>
        <dt>Hits / Misses</dt><dd>${fmtNum(s.cacheHits)} / ${fmtNum(s.cacheMisses)}</dd>
        <dt>Downloaded</dt><dd>${fmtBytes(s.totalDownloadedBytes)}</dd>
        <dt>Evictions</dt><dd>${fmtNum(s.evictions)}</dd>
        <dt>Avg Tile Age</dt><dd>${fmtAge(s.averageTileAgeSeconds)}</dd>
        <dt>Re-downloads</dt><dd>${fmtNum(s.downloadsAfterEviction)}</dd>
        <dt>Flushes</dt><dd>${fmtNum(s.flushes)}</dd>
        <dt>Corruptions</dt><dd style="color:${s.corruptions > 0 ? "var(--red)" : "inherit"}">${fmtNum(s.corruptions)}</dd>
        <dt>Disk</dt><dd>${fmtBytes(s.diskUsedBytes)} / ${fmtBytes(s.diskConfiguredBytes)}</dd>
      </dl>
      <div class="disk-bar">
        <div class="disk-bar-fill" style="width:${(diskPct * 100).toFixed(1)}%;background:${diskColor}"></div>
      </div>
    `;
    $statsContainer.appendChild(card);
  }

  // Update hit ratio chart
  const labels: string[] = [];
  const data: number[] = [];
  const bgColors: string[] = [];
  const bdColors: string[] = [];
  let i = 0;
  for (const [cache, s] of entries) {
    labels.push(cache);
    data.push(s.hitRatio);
    const c = cacheChartColors[i % cacheChartColors.length];
    bgColors.push(c + "60");
    bdColors.push(c);
    i++;
  }
  (hitRatioChart.data.labels as string[]) = labels;
  (hitRatioChart.data.datasets[0].data as number[]) = data;
  (hitRatioChart.data.datasets[0] as any).backgroundColor = bgColors;
  (hitRatioChart.data.datasets[0] as any).borderColor = bdColors;
  hitRatioChart.update();
}

// ── Floating detailed stats ──────────────────────────────────────────────────

function renderFloatingStats(): void {
  const entries = [...latestStats.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  if (entries.length === 0) {
    $floatingContent.innerHTML =
      '<p style="color:var(--text-dim)">Waiting for cache stats…</p>';
    return;
  }

  let html = `<table class="stats-table">
    <thead><tr>
      <th>Cache</th>
      <th>Tiles</th>
      <th>Hit%</th>
      <th>Reqs</th>
      <th>DL</th>
      <th>Evict</th>
      <th>Disk</th>
      <th>Age</th>
    </tr></thead><tbody>`;

  for (const [cache, s] of entries) {
    const ratioColor =
      s.hitRatio > 0.7
        ? "var(--green)"
        : s.hitRatio > 0.4
          ? "var(--orange)"
          : "var(--red)";
    html += `<tr>
      <td style="color:var(--cyan)">${cache}</td>
      <td>${fmtNum(s.tileCount)}</td>
      <td style="color:${ratioColor};font-weight:600">${fmtPct(s.hitRatio)}</td>
      <td>${fmtNum(s.totalRequests)}</td>
      <td>${fmtBytes(s.totalDownloadedBytes)}</td>
      <td>${fmtNum(s.evictions)}</td>
      <td>${fmtBytes(s.diskUsedBytes)}</td>
      <td>${fmtAge(s.averageTileAgeSeconds)}</td>
    </tr>`;
  }

  html += "</tbody></table>";

  // Summary row
  let totalTiles = 0,
    totalReqs = 0,
    totalHits = 0,
    totalDL = 0,
    totalEvict = 0,
    totalDisk = 0;
  for (const [, s] of entries) {
    totalTiles += s.tileCount;
    totalReqs += s.totalRequests;
    totalHits += s.cacheHits;
    totalDL += s.totalDownloadedBytes;
    totalEvict += s.evictions;
    totalDisk += s.diskUsedBytes;
  }
  const overallRatio = totalReqs > 0 ? totalHits / totalReqs : 0;

  html += `<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
    <div><span style="color:var(--text-dim)">Total Tiles</span><br><strong>${fmtNum(totalTiles)}</strong></div>
    <div><span style="color:var(--text-dim)">Overall Hit%</span><br><strong style="color:${overallRatio > 0.7 ? "var(--green)" : "var(--orange)"}">${fmtPct(overallRatio)}</strong></div>
    <div><span style="color:var(--text-dim)">Total DL</span><br><strong>${fmtBytes(totalDL)}</strong></div>
    <div><span style="color:var(--text-dim)">Total Reqs</span><br><strong>${fmtNum(totalReqs)}</strong></div>
    <div><span style="color:var(--text-dim)">Total Evict</span><br><strong>${fmtNum(totalEvict)}</strong></div>
    <div><span style="color:var(--text-dim)">Total Disk</span><br><strong>${fmtBytes(totalDisk)}</strong></div>
  </div>`;

  // Session info
  html += `<div style="margin-top:8px;color:var(--text-dim);font-size:0.75rem">
    Messages: ${fmtNum(messageCount)} · Tile events: ${fmtNum(totalTileEvents)}
  </div>`;

  $floatingContent.innerHTML = html;
}

// ── Toast notifications ──────────────────────────────────────────────────────

function showToast(
  text: string,
  type: "flush" | "corruption" | "info" = "info",
): void {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = text;
  $toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ── Message handlers ─────────────────────────────────────────────────────────

function handleTileBatch(msg: TileBatchMessage): void {
  // Always update feed, counters, and store — regardless of mode
  for (const te of msg.events) {
    addFeedItem(te, msg.time);
    currentSecondBuckets[classifyEvent(te.event)]++;
    currentSecondCount++;
    totalTileEvents++;
  }

  // Always store for replay
  eventStore.add(msg);

  // Only update map if in live mode
  if (timeCursor.isLive()) {
    addTileEventsToMap(msg.events, msg.time);
  }
}

function handleCacheStats(msg: CacheStatsMessage): void {
  for (const [cache, stats] of Object.entries(msg.caches)) {
    if (stats) {
      latestStats.set(cache as CacheType, stats);
    }
  }
  renderCacheStats();
  renderFloatingStats();
}

function handleCacheEvent(msg: CacheEventMessage): void {
  const desc = msg.reason ? ` (${msg.reason})` : "";
  if (msg.event === "flush") {
    const tiles = msg.tilesFlushed ? ` — ${fmtNum(msg.tilesFlushed)} tiles` : "";
    const bytes = msg.bytesFlushed ? `, ${fmtBytes(msg.bytesFlushed)}` : "";
    showToast(`⚠️ FLUSH: ${msg.cache}${desc}${tiles}${bytes}`, "flush");
  } else if (msg.event === "corruption") {
    showToast(`🚨 CORRUPTION: ${msg.cache}${desc}`, "corruption");
  } else {
    showToast(`ℹ️ ${msg.event}: ${msg.cache}${desc}`, "info");
  }
}

function handleLifecycleEvent(msg: LifecycleEventMessage): void {
  if (msg.event === "started") {
    showToast("🟢 Cache monitor started", "info");
  } else if (msg.event === "stopped") {
    showToast("🔴 Cache monitor stopped", "info");
  }
}

function handleMessage(msg: CacheMonitorMessage): void {
  messageCount++;
  $msgCounter.textContent = `${fmtNum(messageCount)} msgs`;

  switch (msg.type) {
    case "tileBatch":
      handleTileBatch(msg);
      break;
    case "cacheStats":
      handleCacheStats(msg);
      break;
    case "cacheEvent":
      handleCacheEvent(msg);
      break;
    case "lifecycleEvent":
      handleLifecycleEvent(msg);
      break;
  }
}

// ── Connection status ────────────────────────────────────────────────────────

function setConnected(connected: boolean, deviceId?: string): void {
  $badge.className = connected
    ? "badge badge-connected"
    : "badge badge-disconnected";
  $badge.textContent = connected ? "Connected" : "Disconnected";
  $deviceId.textContent = deviceId ? `📱 ${deviceId}` : "";
}

// ── Protocol version dialog ──────────────────────────────────────────────────

function showVersionMismatchDialog(
  serverVersion: string,
  severity: "minor" | "major",
): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;
      display:flex;align-items:center;justify-content:center;
    `;

    const icon = severity === "major" ? "🚨" : "⚠️";
    const title = severity === "major"
      ? "Incompatible Protocol Version"
      : "Protocol Version Mismatch";
    const description = severity === "major"
      ? "The server uses a different <strong>major</strong> protocol version. The client and server are likely <strong>incompatible</strong> and may not work correctly."
      : "The server uses a different <strong>minor</strong> protocol version. Some features <strong>may not work</strong> as expected.";

    const dialog = document.createElement("div");
    dialog.style.cssText = `
      background:var(--surface, #1e1e2e);border:1px solid var(--border, #45475a);
      border-radius:12px;padding:24px 28px;max-width:420px;width:90%;
      color:var(--text, #cdd6f4);font-family:inherit;
    `;
    dialog.innerHTML = `
      <div style="font-size:1.4rem;margin-bottom:12px">${icon} ${title}</div>
      <p style="line-height:1.5;margin:0 0 8px">${description}</p>
      <p style="margin:0 0 16px;font-size:0.85rem;color:var(--text-dim, #a6adc8)">
        Client: <strong>v${PROTOCOL_VERSION}</strong> · Server: <strong>v${serverVersion}</strong>
      </p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="version-disconnect" style="
          padding:8px 16px;border-radius:6px;border:1px solid var(--border, #45475a);
          background:transparent;color:var(--text, #cdd6f4);cursor:pointer;
        ">Disconnect</button>
        <button id="version-continue" style="
          padding:8px 16px;border-radius:6px;border:none;
          background:${severity === "major" ? "var(--red, #f38ba8)" : "var(--orange, #fab387)"};
          color:#1e1e2e;font-weight:600;cursor:pointer;
        ">Continue Anyway</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    dialog.querySelector("#version-disconnect")!.addEventListener("click", () => {
      overlay.remove();
      resolve(false);
    });
    dialog.querySelector("#version-continue")!.addEventListener("click", () => {
      overlay.remove();
      resolve(true);
    });
  });
}

// ── WebSocket connection ─────────────────────────────────────────────────────

function connectWs(): void {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  // In dev mode, connect to the backend server on port 3001
  const wsUrl =
    location.port === "5173"
      ? "ws://localhost:3001"
      : `${protocol}//${location.host}`;

  console.log(`[ws] Connecting to ${wsUrl}...`);
  const ws = new WebSocket(wsUrl);
  let versionChecked = false;

  ws.onopen = () => {
    console.log("[ws] Connected");
    showToast("WebSocket connected", "info");
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string);

      // Protocol version handshake (must be the first message from the server)
      if (data.type === "protocolVersion") {
        const msg = data as ProtocolVersion;
        const severity = checkProtocolCompatibility(PROTOCOL_VERSION, msg.version);
        console.log(
          `[ws] Protocol version — client: ${PROTOCOL_VERSION}, server: ${msg.version}, compatibility: ${severity}`,
        );

        if (severity === "compatible") {
          versionChecked = true;
          return;
        }

        // Show dialog and let the user decide
        showVersionMismatchDialog(msg.version, severity).then((continueAnyway) => {
          if (continueAnyway) {
            versionChecked = true;
            showToast(
              `Protocol mismatch (client v${PROTOCOL_VERSION} ↔ server v${msg.version}) — continuing anyway`,
              "info",
            );
          } else {
            ws.close();
          }
        });
        return;
      }

      // Drop messages until protocol version is confirmed
      if (!versionChecked) return;

      // Server status message
      if (data.type === "status") {
        const status = data as ServerStatus;
        setConnected(status.connected, status.deviceId);
        return;
      }

      // Envelope with cache monitor message
      if (data.source && data.message) {
        const envelope = data as WsEnvelope;
        handleMessage(envelope.message);
        return;
      }
    } catch (err) {
      console.error("[ws] Parse error:", err);
    }
  };

  ws.onclose = () => {
    console.log("[ws] Disconnected, reconnecting in 2s...");
    setConnected(false);
    setTimeout(connectWs, 2000);
  };

  ws.onerror = (err) => {
    console.error("[ws] Error:", err);
  };
}

// ── Floating window drag ─────────────────────────────────────────────────────

let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

$floatingHeader.addEventListener("mousedown", (e) => {
  isDragging = true;
  const rect = $floatingWindow.getBoundingClientRect();
  dragOffsetX = e.clientX - rect.left;
  dragOffsetY = e.clientY - rect.top;
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  $floatingWindow.style.left = `${e.clientX - dragOffsetX}px`;
  $floatingWindow.style.top = `${e.clientY - dragOffsetY}px`;
  $floatingWindow.style.right = "auto";
  $floatingWindow.style.bottom = "auto";
});

document.addEventListener("mouseup", () => {
  isDragging = false;
});

// Minimize/restore floating window
$floatingToggle.addEventListener("click", () => {
  $floatingBody.classList.toggle("collapsed");
  $floatingToggle.textContent = $floatingBody.classList.contains("collapsed")
    ? "□"
    : "_";
});

// ── Menu ─────────────────────────────────────────────────────────────────────

$menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  $menuDropdown.classList.toggle("hidden");
});

document.addEventListener("click", () => {
  $menuDropdown.classList.add("hidden");
});

$menuDropdown.addEventListener("click", (e) => {
  e.stopPropagation();
});

$autoZoomToggle.classList.toggle("active", isAutoZoomEnabled());
$autoZoomToggle.addEventListener("click", () => {
  const enabled = !isAutoZoomEnabled();
  setAutoZoomEnabled(enabled);
  $autoZoomToggle.classList.toggle("active", enabled);
});

$menuClearTiles.addEventListener("click", () => {
  clearTiles();
  $menuDropdown.classList.add("hidden");
  showToast("Tile map cleared", "info");
});

$menuClearKey.addEventListener("click", () => {
  clearApiKey();
  $menuDropdown.classList.add("hidden");
  showToast("API key cleared — reload to enter a new key", "info");
});

// ── Go Live button ───────────────────────────────────────────────────────────

$goLiveBtn.addEventListener("click", () => {
  timeCursor.goLive(Date.now());
  timelineSlider.updatePosition();
});

// ── Source filter buttons ─────────────────────────────────────────────────────

const $sourceButtons = document.querySelectorAll<HTMLButtonElement>(".source-btn");

for (const btn of $sourceButtons) {
  btn.addEventListener("click", () => {
    const label = btn.dataset.source!;
    toggleSourceFilter(label);
  });
}

onSourceFilterChange((enabled) => {
  for (const btn of $sourceButtons) {
    const label = btn.dataset.source!;
    btn.classList.toggle("active", enabled.has(label));
  }
});

// ── Level filter buttons ─────────────────────────────────────────────────────

const $levelButtons = document.querySelectorAll<HTMLButtonElement>(".level-btn");

for (const btn of $levelButtons) {
  btn.addEventListener("click", () => {
    const label = btn.dataset.level!;
    toggleLevelFilter(label);
  });
}

onLevelFilterChange((enabled) => {
  for (const btn of $levelButtons) {
    const label = btn.dataset.level!;
    btn.classList.toggle("active", enabled.has(label));
  }
});

// ── Init ─────────────────────────────────────────────────────────────────────

initMap();
connectWs();
renderFloatingStats();

console.log("Cache Monitor UI initialized");
