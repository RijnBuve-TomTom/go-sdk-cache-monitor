### Time Machine Slider — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **IMPORTANT — Scratchpad rule:** After completing every task, you MUST update `docs/plans/implementation-plan-time-slider-scratchpad.md` with the most important design and implementation decisions made during that task that affect subsequent tasks. Fill in the corresponding "After Task N" section with concrete decisions, trade-offs, discovered issues, and guidance for the next steps. This keeps a living record of context so that later tasks can be executed with full awareness of earlier choices.

**Goal:** Add a draggable timeline slider to the event rate chart that lets users scrub back in time and see the map state at any historical moment, acting as a "time machine."

**Architecture:** Introduce an `EventStore` that buffers all incoming tile batch events with timestamps. A `TimeCursor` state module tracks whether the UI is in "live" mode (green indicator, map updates in real-time) or "historical" mode (red indicator, map frozen at cursor time). A custom timeline slider rendered below the rate chart lets users drag a "now" indicator back and forth. When in historical mode, incoming events are still stored but the map is only rebuilt from events up to the cursor time. Dragging the indicator back to the right edge (current time) re-enables live mode.

**Tech Stack:** TypeScript, Chart.js (existing), MapLibre GL (existing), Vite (existing), plain DOM for slider

---

### Task 1: Create the EventStore module

**Purpose:** Store all incoming tile batch events so we can replay map state at any point in time.

**Files:**
- Create: `src/client/event-store.ts`
- Test: `src/client/event-store.test.ts`

**Step 1: Write the failing test**

```typescript
// src/client/event-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { EventStore } from "./event-store";
import type { TileBatchMessage } from "../shared/types";

function makeBatch(time: number, count: number): TileBatchMessage {
  return {
    type: "tileBatch",
    time,
    events: Array.from({ length: count }, (_, i) => ({
      cache: "mapVector" as const,
      tileId: 1000 + i,
      event: "hit" as const,
    })),
  };
}

describe("EventStore", () => {
  let store: EventStore;
  beforeEach(() => { store = new EventStore(); });

  it("stores and retrieves batches", () => {
    store.add(makeBatch(1000, 2));
    store.add(makeBatch(2000, 3));
    expect(store.size()).toBe(2);
  });

  it("getEventsUpTo returns only events <= cutoff time", () => {
    store.add(makeBatch(1000, 1));
    store.add(makeBatch(2000, 1));
    store.add(makeBatch(3000, 1));
    const result = store.getEventsUpTo(2000);
    expect(result.length).toBe(2);
    expect(result[0].time).toBe(1000);
    expect(result[1].time).toBe(2000);
  });

  it("getEventsUpTo with Infinity returns all events", () => {
    store.add(makeBatch(1000, 1));
    store.add(makeBatch(5000, 1));
    expect(store.getEventsUpTo(Infinity).length).toBe(2);
  });

  it("getTimeRange returns min/max timestamps", () => {
    store.add(makeBatch(1000, 1));
    store.add(makeBatch(5000, 1));
    expect(store.getTimeRange()).toEqual({ min: 1000, max: 5000 });
  });

  it("getTimeRange returns null when empty", () => {
    expect(store.getTimeRange()).toBeNull();
  });

  it("prunes events older than maxAge", () => {
    store.add(makeBatch(1000, 1));
    store.add(makeBatch(90_000, 1));
    store.add(makeBatch(100_000, 1));
    store.prune(100_000, 60_000); // keep last 60s
    expect(store.size()).toBe(2);
    expect(store.getEventsUpTo(Infinity)[0].time).toBe(90_000);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/client/event-store.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/client/event-store.ts
import type { TileBatchMessage } from "../shared/types";

/**
 * Stores incoming TileBatchMessages in chronological order
 * so the map state can be replayed at any historical time.
 */
export class EventStore {
  private batches: TileBatchMessage[] = [];

  /** Append a new batch (assumed to arrive in chronological order). */
  add(batch: TileBatchMessage): void {
    this.batches.push(batch);
  }

  /** Return all batches with time <= cutoffMs. */
  getEventsUpTo(cutoffMs: number): TileBatchMessage[] {
    return this.batches.filter((b) => b.time <= cutoffMs);
  }

  /** Return the min/max timestamps, or null if empty. */
  getTimeRange(): { min: number; max: number } | null {
    if (this.batches.length === 0) return null;
    return {
      min: this.batches[0].time,
      max: this.batches[this.batches.length - 1].time,
    };
  }

  /** Remove batches older than (now - maxAgeMs). */
  prune(now: number, maxAgeMs: number): void {
    const cutoff = now - maxAgeMs;
    this.batches = this.batches.filter((b) => b.time >= cutoff);
  }

  /** Number of stored batches. */
  size(): number {
    return this.batches.length;
  }

  /** Clear all stored events. */
  clear(): void {
    this.batches = [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/client/event-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/client/event-store.ts src/client/event-store.test.ts
git commit -m "feat: add EventStore for time-machine replay"
```

**Step 6: Update scratchpad**

Update the "After Task 1" section in `docs/plans/implementation-plan-time-slider-scratchpad.md` with key decisions made during this task — e.g., data structure choice (flat array vs. other), API surface (`add`, `getEventsUpTo`, `getTimeRange`, `prune`, `size`, `clear`), performance characteristics of `filter()` for `getEventsUpTo`, assumed chronological insertion order, and any deviations from the plan or issues encountered.

---

### Task 2: Create the TimeCursor state module

**Purpose:** Manage the "live vs historical" state and the cursor timestamp. This is a pure state module with no DOM dependencies, so it's easily testable.

**Files:**
- Create: `src/client/time-cursor.ts`
- Test: `src/client/time-cursor.test.ts`

**Step 1: Write the failing test**

```typescript
// src/client/time-cursor.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TimeCursor } from "./time-cursor";

describe("TimeCursor", () => {
  let cursor: TimeCursor;
  const onChange = vi.fn();

  beforeEach(() => {
    cursor = new TimeCursor(onChange);
    onChange.mockClear();
  });

  it("starts in live mode", () => {
    expect(cursor.isLive()).toBe(true);
  });

  it("setTime with a past time enters historical mode", () => {
    cursor.setTime(5000, 10000); // cursor=5s, now=10s
    expect(cursor.isLive()).toBe(false);
    expect(cursor.getTime()).toBe(5000);
    expect(onChange).toHaveBeenCalledWith({ isLive: false, time: 5000 });
  });

  it("setTime at now enters live mode", () => {
    cursor.setTime(5000, 10000); // go to past first
    onChange.mockClear();
    cursor.setTime(10000, 10000); // back to now
    expect(cursor.isLive()).toBe(true);
    expect(onChange).toHaveBeenCalledWith({ isLive: true, time: 10000 });
  });

  it("setTime near now (within snap threshold) snaps to live", () => {
    cursor.setTime(9800, 10000); // 200ms away, within 500ms snap
    expect(cursor.isLive()).toBe(true);
  });

  it("goLive resets to live mode", () => {
    cursor.setTime(5000, 10000);
    onChange.mockClear();
    cursor.goLive(12000);
    expect(cursor.isLive()).toBe(true);
    expect(cursor.getTime()).toBe(12000);
    expect(onChange).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/client/time-cursor.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/client/time-cursor.ts

export interface TimeCursorState {
  isLive: boolean;
  time: number;
}

export type TimeCursorChangeCallback = (state: TimeCursorState) => void;

const SNAP_THRESHOLD_MS = 500; // snap to live if within 500ms of "now"

export class TimeCursor {
  private live = true;
  private cursorTime = 0;
  private onChange: TimeCursorChangeCallback;

  constructor(onChange: TimeCursorChangeCallback) {
    this.onChange = onChange;
  }

  /** Is the cursor at the live (current) position? */
  isLive(): boolean {
    return this.live;
  }

  /** Current cursor timestamp. */
  getTime(): number {
    return this.cursorTime;
  }

  /**
   * Set cursor to a specific time.
   * If within SNAP_THRESHOLD_MS of `now`, snaps to live.
   */
  setTime(time: number, now: number): void {
    if (Math.abs(time - now) <= SNAP_THRESHOLD_MS) {
      this.live = true;
      this.cursorTime = now;
    } else {
      this.live = false;
      this.cursorTime = time;
    }
    this.onChange({ isLive: this.live, time: this.cursorTime });
  }

  /** Force back to live mode. */
  goLive(now: number): void {
    this.live = true;
    this.cursorTime = now;
    this.onChange({ isLive: true, time: now });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/client/time-cursor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/client/time-cursor.ts src/client/time-cursor.test.ts
git commit -m "feat: add TimeCursor state module for live/historical mode"
```

**Step 6: Update scratchpad**

Update the "After Task 2" section in `docs/plans/implementation-plan-time-slider-scratchpad.md` with key decisions made during this task — e.g., callback-based notification pattern, snap threshold value (500ms) and rationale, state representation (boolean `live` + `cursorTime`), and any deviations from the plan or issues encountered.

---

### Task 3: Add the timeline slider HTML and CSS

**Purpose:** Add the slider UI element below the rate chart. This is a custom `<div>`-based slider with a draggable thumb, a track, and a time label.

**Files:**
- Modify: `src/client/index.html` (add slider container after the rate chart canvas)
- Modify: `src/client/styles.css` (add timeline slider styles)

**Step 1: Add the HTML element**

In `src/client/index.html`, inside the `<section id="charts">` block (after line 66 — the `rate-chart` canvas), add:

```html
<div id="timeline-slider" class="timeline-slider">
  <div class="timeline-track">
    <div class="timeline-elapsed" id="timeline-elapsed"></div>
    <div class="timeline-thumb" id="timeline-thumb" title="Drag to travel in time">
      <span class="timeline-thumb-arrow">▼</span>
    </div>
  </div>
  <div class="timeline-labels">
    <span id="timeline-label-start" class="timeline-label">-60s</span>
    <span id="timeline-label-cursor" class="timeline-label timeline-label-cursor"></span>
    <span id="timeline-label-end" class="timeline-label">now</span>
  </div>
</div>
```

**Step 2: Add the CSS styles**

Append to `src/client/styles.css`:

```css
/* ── Timeline slider ──────────────────────────────────────────────────────── */

.timeline-slider {
  position: relative;
  padding: 6px 8px 2px;
  user-select: none;
}

.timeline-track {
  position: relative;
  height: 6px;
  background: var(--bg-card);
  border-radius: 3px;
  border: 1px solid var(--border);
  cursor: pointer;
}

.timeline-elapsed {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: var(--green);
  border-radius: 3px;
  transition: background 0.2s;
  pointer-events: none;
}

.timeline-elapsed.historical {
  background: var(--red);
}

.timeline-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 18px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  z-index: 10;
  color: var(--green);
  font-size: 16px;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
  transition: color 0.2s;
}

.timeline-thumb.historical {
  color: var(--red);
}

.timeline-thumb:active {
  cursor: grabbing;
}

.timeline-thumb-arrow {
  line-height: 1;
}

.timeline-labels {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 2px;
}

.timeline-label {
  font-size: 0.65rem;
  color: var(--text-dim);
  font-family: var(--font);
}

.timeline-label-cursor {
  font-weight: 700;
  color: var(--green);
  transition: color 0.2s;
  min-width: 60px;
  text-align: center;
}

.timeline-label-cursor.historical {
  color: var(--red);
}
```

**Step 3: Verify visually**

Run: `npm run demo` in one terminal, `npm run dev` in another. Open `http://localhost:5173`. The slider track should appear below the rate chart. It won't be functional yet, just visible.

**Step 4: Commit**

```bash
git add src/client/index.html src/client/styles.css
git commit -m "feat: add timeline slider HTML and CSS"
```

**Step 5: Update scratchpad**

Update the "After Task 3" section in `docs/plans/implementation-plan-time-slider-scratchpad.md` with key decisions made during this task — e.g., DOM structure choices, CSS custom properties used, positioning approach relative to rate chart, and any deviations from the plan or visual issues encountered.

---

### Task 4: Create the timeline slider interaction module

**Purpose:** Handle drag interactions on the slider thumb. Translates pixel position to a timestamp and calls `TimeCursor.setTime()`.

**Files:**
- Create: `src/client/timeline-slider.ts`

**Step 1: Write the implementation**

```typescript
// src/client/timeline-slider.ts
import type { TimeCursor } from "./time-cursor";

export interface TimelineSliderElements {
  track: HTMLElement;
  thumb: HTMLElement;
  elapsed: HTMLElement;
  labelCursor: HTMLElement;
}

/**
 * Manages the timeline slider UI: drag thumb, update position,
 * and communicate with TimeCursor.
 */
export class TimelineSlider {
  private els: TimelineSliderElements;
  private cursor: TimeCursor;
  private dragging = false;
  private timeRangeMs = 60_000; // visible window = 60s
  private latestNow = Date.now();

  constructor(els: TimelineSliderElements, cursor: TimeCursor) {
    this.els = els;
    this.cursor = cursor;
    this.bindEvents();
    this.updatePosition(); // start at live (right edge)
  }

  /** Call this on every animation frame or 1s tick to keep "now" advancing. */
  tick(now: number): void {
    this.latestNow = now;
    if (this.cursor.isLive()) {
      this.updatePosition();
    }
  }

  /** Set the visible time window (e.g. 60_000 for 60s). */
  setTimeRange(ms: number): void {
    this.timeRangeMs = ms;
  }

  /** Update the thumb position and labels from the cursor state. */
  updatePosition(): void {
    const isLive = this.cursor.isLive();
    const cursorTime = isLive ? this.latestNow : this.cursor.getTime();
    const rangeStart = this.latestNow - this.timeRangeMs;
    const rangeEnd = this.latestNow;

    // Clamp the fraction between 0 and 1
    let frac = (cursorTime - rangeStart) / (rangeEnd - rangeStart);
    frac = Math.max(0, Math.min(1, frac));

    const pct = `${(frac * 100).toFixed(2)}%`;
    this.els.thumb.style.left = pct;
    this.els.elapsed.style.width = pct;

    // Toggle historical class
    const method = isLive ? "remove" : "add";
    this.els.thumb.classList[method]("historical");
    this.els.elapsed.classList[method]("historical");
    this.els.labelCursor.classList[method]("historical");

    // Update label
    if (isLive) {
      this.els.labelCursor.textContent = "● LIVE";
    } else {
      const deltaS = ((cursorTime - this.latestNow) / 1000).toFixed(0);
      this.els.labelCursor.textContent = `${deltaS}s`;
    }
  }

  private bindEvents(): void {
    // Mouse drag on thumb
    this.els.thumb.addEventListener("mousedown", (e) => {
      this.dragging = true;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.dragging) return;
      this.handlePointerMove(e.clientX);
    });

    document.addEventListener("mouseup", () => {
      if (this.dragging) {
        this.dragging = false;
      }
    });

    // Touch drag on thumb
    this.els.thumb.addEventListener("touchstart", (e) => {
      this.dragging = true;
      e.preventDefault();
    });

    document.addEventListener("touchmove", (e) => {
      if (!this.dragging) return;
      this.handlePointerMove(e.touches[0].clientX);
    });

    document.addEventListener("touchend", () => {
      if (this.dragging) {
        this.dragging = false;
      }
    });

    // Click on track to jump
    this.els.track.addEventListener("click", (e) => {
      this.handlePointerMove(e.clientX);
    });
  }

  private handlePointerMove(clientX: number): void {
    const rect = this.els.track.getBoundingClientRect();
    let frac = (clientX - rect.left) / rect.width;
    frac = Math.max(0, Math.min(1, frac));

    const rangeStart = this.latestNow - this.timeRangeMs;
    const time = rangeStart + frac * this.timeRangeMs;

    this.cursor.setTime(time, this.latestNow);
    this.updatePosition();
  }
}
```

**Step 2: Verify visually**

This module will be wired in the next task. No manual test needed yet.

**Step 3: Commit**

```bash
git add src/client/timeline-slider.ts
git commit -m "feat: add TimelineSlider interaction module"
```

**Step 4: Update scratchpad**

Update the "After Task 4" section in `docs/plans/implementation-plan-time-slider-scratchpad.md` with key decisions made during this task — e.g., pointer event handling approach (mouse + touch), coordinate-to-time mapping logic, dependency on TimeCursor, tick/animation strategy, and any deviations from the plan or issues encountered.

---

### Task 5: Wire EventStore and TimeCursor into main.ts

**Purpose:** Integrate the new modules into the main application. Store events, gate map updates, and handle cursor changes.

**Files:**
- Modify: `src/client/main.ts`

**Step 1: Add imports and instantiate modules**

At the top of `main.ts`, add imports (after existing imports around line 19):

```typescript
import { EventStore } from "./event-store";
import { TimeCursor } from "./time-cursor";
import { TimelineSlider } from "./timeline-slider";
```

**Step 2: Add DOM refs for the slider**

After the existing DOM refs block (around line 41), add:

```typescript
const $timelineTrack = document.getElementById("timeline-slider")!.querySelector(".timeline-track")! as HTMLElement;
const $timelineThumb = document.getElementById("timeline-thumb")!;
const $timelineElapsed = document.getElementById("timeline-elapsed")!;
const $timelineLabelCursor = document.getElementById("timeline-label-cursor")!;
```

**Step 3: Instantiate state modules**

After the State section (around line 64), add:

```typescript
// ── Time machine state ──────────────────────────────────────────────────────

const eventStore = new EventStore();
const EVENT_STORE_MAX_AGE_MS = 120_000; // keep 2 minutes of history

const timeCursor = new TimeCursor((state) => {
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
```

**Step 4: Add the rebuildMapFromStore function**

After the `classifyEvent` function (around line 221), add:

```typescript
/**
 * Rebuild the map from stored events up to `cutoffMs`.
 * Clears current tiles first, then replays all events in order.
 */
function rebuildMapFromStore(cutoffMs: number): void {
  clearTiles();
  const batches = eventStore.getEventsUpTo(cutoffMs);
  for (const batch of batches) {
    addTileEventsToMap(batch.events, batch.time);
  }
}
```

**Step 5: Modify handleTileBatch to use the event store and gating**

Replace the existing `handleTileBatch` function (lines 446–454) with:

```typescript
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
```

**Step 6: Add timeline tick to the existing 1-second interval**

In the existing `setInterval(() => { ... }, 1000)` block (around line 223), add at the end (before the closing `}, 1000);`):

```typescript
  // Prune old events from the store
  eventStore.prune(Date.now(), EVENT_STORE_MAX_AGE_MS);

  // Tick the timeline slider
  timelineSlider.tick(Date.now());
```

**Step 7: Verify end-to-end**

Run: `npm run demo` + `npm run dev`. Open browser.
- The slider should appear below the rate chart
- The thumb should sit at the right edge labeled "● LIVE" in green
- Dragging the thumb left should turn it red with a negative seconds label
- The map should update to show only events up to the cursor time
- Releasing at the right edge should resume live mode

**Step 8: Commit**

```bash
git add src/client/main.ts
git commit -m "feat: wire EventStore, TimeCursor, and TimelineSlider into main app"
```

**Step 9: Update scratchpad**

Update the "After Task 5" section in `docs/plans/implementation-plan-time-slider-scratchpad.md` with key decisions made during this task — e.g., integration points in main.ts, how gating logic works (only map frozen, feed/counters/chart stay live), prune interval and max age choice (120s), rebuildMapFromStore approach, and any deviations from the plan or issues encountered.

---

### Task 6: Add the `rebuildMapFromStore` function to tile-map.ts as an export

**Purpose:** The `clearTiles` function is already exported from `tile-map.ts`, but the current approach in Task 5 calls `clearTiles()` then re-adds events. This works but may need a dedicated `replayTileEvents` function that efficiently rebuilds without triggering auto-zoom on every batch. Add a `replayTileEventsToMap` function that batches all events before updating the map source once.

**Files:**
- Modify: `src/client/tile-map.ts`
- Modify: `src/client/main.ts` (use the new function)

**Step 1: Add replayTileEventsToMap to tile-map.ts**

Add after the `addTileEventsToMap` function (around line 500):

```typescript
/**
 * Replay a series of tile batches onto the map efficiently.
 * Clears existing tiles, replays all events, then updates the map source once.
 */
export function replayTileEventsToMap(
  batches: { events: TileEvent[]; time: number }[],
): void {
  if (!map) return;

  // Clear existing tracked tiles (no map source update yet)
  trackedTiles.clear();
  removeAllDialogs();

  // Replay all batches into tracked tiles
  for (const batch of batches) {
    for (const te of batch.events) {
      const key = tileKey(te.cache, te.tileId);
      const existing = trackedTiles.get(key);
      if (existing) {
        existing.events.push({
          event: te.event,
          cache: te.cache,
          time: batch.time,
          sizeBytes: te.sizeBytes,
          httpCode: te.httpCode,
        });
        existing.latestEvent = te.event;
        existing.addedAt = batch.time;
      } else {
        trackedTiles.set(key, {
          tileId: te.tileId,
          cache: te.cache,
          events: [{
            event: te.event,
            cache: te.cache,
            time: batch.time,
            sizeBytes: te.sizeBytes,
            httpCode: te.httpCode,
          }],
          latestEvent: te.event,
          addedAt: batch.time,
        });
      }
    }
  }

  // Enforce max tile limit (remove oldest)
  if (trackedTiles.size > MAX_TILES) {
    const sorted = [...trackedTiles.entries()].sort((a, b) => a[1].addedAt - b[1].addedAt);
    const toRemove = sorted.slice(0, trackedTiles.size - MAX_TILES);
    for (const [key] of toRemove) {
      trackedTiles.delete(key);
    }
  }

  // Update map sources once
  const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(buildFeatureCollection());
  }
  const crossSource = map.getSource(CROSS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (crossSource) {
    crossSource.setData(buildCrossFeatureCollection());
  }

  if (autoZoomEnabled) {
    fitMapToTiles();
  }
}
```

**Step 2: Update the import in main.ts**

Update the import line (line 19) to include `replayTileEventsToMap`:

```typescript
import { initMap, addTileEventsToMap, replayTileEventsToMap, clearApiKey, clearTiles, isAutoZoomEnabled, setAutoZoomEnabled } from "./tile-map";
```

**Step 3: Replace `rebuildMapFromStore` in main.ts**

Replace the `rebuildMapFromStore` function with:

```typescript
function rebuildMapFromStore(cutoffMs: number): void {
  const batches = eventStore.getEventsUpTo(cutoffMs);
  replayTileEventsToMap(batches);
}
```

**Step 4: Verify**

Run the app. Drag the slider back and forth — the map should efficiently rebuild without flickering.

**Step 5: Commit**

```bash
git add src/client/tile-map.ts src/client/main.ts
git commit -m "feat: add efficient replayTileEventsToMap for time-machine rebuild"
```

**Step 6: Update scratchpad**

Update the "After Task 6" section in `docs/plans/implementation-plan-time-slider-scratchpad.md` with key decisions made during this task — e.g., replay performance strategy (batch all tile updates then single map source update), how trackedTiles.clear() interacts with replay, MAX_TILES enforcement during replay, auto-zoom behavior during replay, and any deviations from the plan or issues encountered.

---

### Task 7: Visual polish and edge cases

**Purpose:** Handle edge cases and refine the visual experience.

**Files:**
- Modify: `src/client/timeline-slider.ts` (edge cases)
- Modify: `src/client/main.ts` (edge cases)
- Modify: `src/client/styles.css` (polish)

**Step 1: Handle empty event store (no events yet)**

In `TimelineSlider.updatePosition()`, add at the top:

```typescript
// If no events yet, keep the thumb at the right edge
if (this.timeRangeMs <= 0) return;
```

**Step 2: Add a "Go Live" button**

In `src/client/index.html`, add inside the `#timeline-slider` div, after the labels div:

```html
<button id="timeline-go-live" class="timeline-go-live hidden" title="Return to live">● LIVE</button>
```

Add CSS for the button:

```css
.timeline-go-live {
  position: absolute;
  top: -2px;
  right: 0;
  padding: 2px 8px;
  font-size: 0.65rem;
  font-weight: 700;
  font-family: var(--font);
  color: var(--green);
  background: rgba(52, 211, 153, 0.15);
  border: 1px solid var(--green);
  border-radius: 4px;
  cursor: pointer;
  transition: opacity 0.2s;
  z-index: 5;
}

.timeline-go-live:hover {
  background: rgba(52, 211, 153, 0.3);
}

.timeline-go-live.hidden {
  display: none;
}
```

In `main.ts`, wire the button:

```typescript
const $goLiveBtn = document.getElementById("timeline-go-live")!;

// Show/hide "Go Live" button based on cursor state
// Add to the TimeCursor onChange callback:
// (update the existing timeCursor instantiation)
const timeCursor = new TimeCursor((state) => {
  $goLiveBtn.classList.toggle("hidden", state.isLive);
  if (state.isLive) {
    rebuildMapFromStore(Infinity);
  } else {
    rebuildMapFromStore(state.time);
  }
});

$goLiveBtn.addEventListener("click", () => {
  timeCursor.goLive(Date.now());
  timelineSlider.updatePosition();
});
```

**Step 3: Add tooltip on thumb hover showing the exact time**

Update the thumb `title` attribute dynamically in `TimelineSlider.updatePosition()`:

```typescript
// Inside updatePosition(), after setting the label:
if (isLive) {
  this.els.thumb.title = "Live — drag to travel in time";
} else {
  const date = new Date(cursorTime);
  this.els.thumb.title = date.toLocaleTimeString("en-US", { hour12: false });
}
```

**Step 4: Ensure the slider doesn't go before the first stored event**

In `TimelineSlider.handlePointerMove()`, clamp the time to the event store range if available. This requires passing the `EventStore` to the slider. Alternatively, just let the user drag freely — events before the store window simply result in an empty map, which is fine behavior.

**Step 5: Verify**

- Drag slider left → red thumb, red label, "Go Live" button appears
- Click "Go Live" → snaps back, green, button hides
- Hover thumb → shows time tooltip
- Empty state (just loaded, no events) → thumb at right edge, no errors

**Step 6: Commit**

```bash
git add src/client/index.html src/client/styles.css src/client/main.ts src/client/timeline-slider.ts
git commit -m "feat: add Go Live button, tooltip, and visual polish for timeline"
```

**Step 7: Update scratchpad**

Update the "After Task 7" section in `docs/plans/implementation-plan-time-slider-scratchpad.md` with final decisions — e.g., edge cases handled (empty store, near-live snap), Go Live button behavior, tooltip formatting, any remaining known limitations or follow-up items, and any deviations from the plan.

---

### Summary of all tasks

| Task | Description | Files |
|------|-------------|-------|
| **1** | Create `EventStore` module + tests | `event-store.ts`, `event-store.test.ts` |
| **2** | Create `TimeCursor` state module + tests | `time-cursor.ts`, `time-cursor.test.ts` |
| **3** | Add timeline slider HTML + CSS | `index.html`, `styles.css` |
| **4** | Create `TimelineSlider` interaction module | `timeline-slider.ts` |
| **5** | Wire everything into `main.ts` | `main.ts` |
| **6** | Add efficient `replayTileEventsToMap` | `tile-map.ts`, `main.ts` |
| **7** | Visual polish + edge cases + "Go Live" button | All client files |

### Key Design Decisions

- **Event store retention:** 2 minutes (120s) — enough for meaningful scrubbing, not enough to blow up memory. The rate chart shows 60s, but keeping 2× allows scrubbing slightly beyond the visible chart.
- **Snap threshold:** 500ms — if the user drags within 500ms of "now", it snaps to live mode. This prevents the annoying edge case where you're "almost" live but stuck in historical mode.
- **Feed/counters always update:** Only the map is frozen in historical mode. The feed list, event counters, and rate chart continue updating in real-time so the user can see events are still flowing.
- **Efficient replay:** `replayTileEventsToMap` rebuilds all tiles in memory first, then updates the map source once — avoiding N source updates for N batches.
- **No server changes needed:** This is entirely a client-side feature. The server continues streaming events normally.
