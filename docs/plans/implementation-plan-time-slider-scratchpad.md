### Time Machine Slider — Design & Implementation Decisions Scratchpad

> **Purpose:** After completing each task, record the most important design and implementation decisions that affect subsequent tasks. This serves as a living record of context, trade-offs, and guidance for the next steps.

---

#### After Task 1 (EventStore module)

_Record here: key decisions about data structure choices, performance trade-offs, API surface, and anything that impacts Tasks 2–7._

- [x] **Data structure:** Flat `TileBatchMessage[]` array, appended in chronological order. Simple and sufficient for the expected 2-minute retention window.
- [x] **API surface:** `add`, `getEventsUpTo`, `getTimeRange`, `prune`, `size`, `clear` — exactly as planned. No deviations.
- [x] **`getEventsUpTo` uses `Array.filter()`** — O(n) linear scan. Acceptable for a 2-minute window at typical event rates. If performance becomes an issue in Task 6 (replay), a binary search on the sorted `time` field could be added, but premature optimization isn't warranted now.
- [x] **Chronological insertion assumed:** `add()` does not sort; it trusts that batches arrive in order (guaranteed by the server's streaming order). `getTimeRange()` relies on this by reading first/last elements.
- [x] **`prune()` takes explicit `now` and `maxAgeMs`** rather than using `Date.now()` internally — keeps the module pure and testable. Caller (main.ts in Task 5) will pass `Date.now()` and `120_000`.
- [x] **No deviations from the plan.** Implementation matches the plan exactly.

---

#### After Task 2 (TimeCursor state module)

_Record here: decisions about state management approach, callback design, snap threshold rationale, and anything that impacts Tasks 3–7._

- [x] **State representation:** Boolean `live` flag + numeric `cursorTime`. Starts in live mode (`live = true`, `cursorTime = 0`). Simple and sufficient — no enum or state machine needed.
- [x] **Callback-based notification:** Constructor takes a single `TimeCursorChangeCallback` that fires on every `setTime()` and `goLive()` call with `{ isLive, time }`. This decouples the cursor from DOM/UI — the callback in Task 5 will handle map rebuilds and UI updates.
- [x] **Snap threshold:** 500ms (`SNAP_THRESHOLD_MS`). Uses `Math.abs(time - now)` so it works for both dragging from the left (past) toward now and edge cases. When snapping, `cursorTime` is set to `now` (not the raw drag time) for clean state.
- [x] **`setTime(time, now)` takes explicit `now` parameter** — same pure/testable pattern as EventStore's `prune()`. Caller passes `Date.now()` or `latestNow` from the slider tick. This keeps the module deterministic in tests.
- [x] **`goLive(now)` is unconditional** — always sets `live = true` and fires callback, even if already live. This simplifies the "Go Live" button wiring in Task 7 (no need to check current state first).
- [x] **Exported types:** `TimeCursorState` interface and `TimeCursorChangeCallback` type are exported for use by TimelineSlider (Task 4) and main.ts (Task 5).
- [x] **No deviations from the plan.** Implementation and tests match the plan exactly.

---

#### After Task 3 (Timeline slider HTML and CSS)

_Record here: decisions about DOM structure, CSS variable usage, layout positioning relative to the rate chart, and anything that impacts Tasks 4–7._

- [x] **DOM structure:** Slider inserted directly after the `<canvas id="rate-chart">` inside `<section id="charts">`, before the Hit Ratio chart. Structure is `#timeline-slider > .timeline-track > (.timeline-elapsed + .timeline-thumb)` plus `.timeline-labels` with three spans (start, cursor, end).
- [x] **Element IDs for Task 4/5 wiring:** `timeline-slider` (container), `timeline-elapsed` (filled portion), `timeline-thumb` (draggable indicator), `timeline-label-start`, `timeline-label-cursor`, `timeline-label-end`. Task 4's `TimelineSliderElements` interface expects `track`, `thumb`, `elapsed`, `labelCursor` — all present.
- [x] **CSS custom properties:** Uses existing `:root` variables — `--bg-card` (track background), `--border` (track border), `--green` (live state color), `--red` (historical state color via `.historical` class), `--text-dim` (label color), `--font` (label font). No new CSS variables introduced.
- [x] **Historical state toggling:** `.historical` class is defined for `.timeline-elapsed`, `.timeline-thumb`, and `.timeline-label-cursor` — switches color from green to red. Task 4's `updatePosition()` will toggle this class via `classList.add/remove`.
- [x] **Thumb uses `▼` arrow character** (`<span class="timeline-thumb-arrow">▼</span>`) styled with `drop-shadow` filter for visibility against the dark background. Positioned with `transform: translate(-50%, -50%)` for center-alignment on the track.
- [x] **No deviations from the plan.** Implementation matches the plan exactly.

---

#### After Task 4 (TimelineSlider interaction module)

_Record here: decisions about pointer event handling, coordinate-to-time mapping, touch support approach, and anything that impacts Tasks 5–7._

- [x] **Pointer event handling:** Separate mouse (`mousedown`/`mousemove`/`mouseup`) and touch (`touchstart`/`touchmove`/`touchend`) listeners. `mousedown` and `touchstart` are on the thumb element; `mousemove`/`mouseup` and `touchmove`/`touchend` are on `document` so dragging continues even when the pointer leaves the thumb. Track click also triggers `handlePointerMove` for jump-to-position.
- [x] **Coordinate-to-time mapping:** `handlePointerMove(clientX)` computes a fraction `(clientX - rect.left) / rect.width` clamped to [0, 1], then maps it to `rangeStart + frac * timeRangeMs` where `rangeStart = latestNow - timeRangeMs`. Calls `cursor.setTime(time, latestNow)` which handles snap-to-live via the 500ms threshold.
- [x] **Tick/animation strategy:** `tick(now)` updates `latestNow` and calls `updatePosition()` only when in live mode. Caller (main.ts in Task 5) will invoke this from the existing 1-second `setInterval`. No `requestAnimationFrame` loop needed — 1s granularity is sufficient for the slider position.
- [x] **Visual state toggling:** `updatePosition()` toggles `.historical` class on thumb, elapsed bar, and cursor label — matching the CSS classes defined in Task 3. Label shows "● LIVE" (green) or negative seconds like "-30s" (red).
- [x] **TimelineSliderElements interface:** Expects `{ track, thumb, elapsed, labelCursor }` — Task 5 will query these by ID from the DOM elements created in Task 3.
- [x] **Default time range:** 60,000ms (60s) matching the rate chart window. `setTimeRange(ms)` allows changing it if needed.
- [x] **No deviations from the plan.** Implementation matches the plan exactly. No tests required for this module per plan (it's DOM-dependent; wiring and visual verification happen in Task 5).

---

#### After Task 5 (Wire EventStore and TimeCursor into main.ts)

_Record here: decisions about integration points, gating logic for live vs historical mode, interval timing, and anything that impacts Tasks 6–7._

- [x] **Integration points:** Three new imports (`EventStore`, `TimeCursor`, `TimelineSlider`) added after the `tile-map` import. Four new DOM refs (`$timelineTrack`, `$timelineThumb`, `$timelineElapsed`, `$timelineLabelCursor`) added after the existing DOM refs block. Time machine state block placed between hit ratio history and formatters sections.
- [x] **Gating logic in `handleTileBatch`:** Feed items, rate counters (`currentSecondBuckets`), and total event count always update regardless of mode — keeping the feed, rate chart, and counters live. `eventStore.add(msg)` always stores for replay. `addTileEventsToMap` is only called when `timeCursor.isLive()` is true — this is the sole gate that freezes the map in historical mode.
- [x] **`rebuildMapFromStore` approach:** Calls `clearTiles()` then replays all batches via `addTileEventsToMap` in a loop. This is the simple/correct approach for Task 5. Task 6 will replace this with the more efficient `replayTileEventsToMap` that batches all tile updates before a single map source update, avoiding N source updates for N batches.
- [x] **TimeCursor callback:** Wired directly in the constructor — calls `rebuildMapFromStore(Infinity)` on live resume, `rebuildMapFromStore(state.time)` on historical scrub. This fires on every `setTime()` and `goLive()` call.
- [x] **Prune and tick in setInterval:** Both `eventStore.prune(Date.now(), 120_000)` and `timelineSlider.tick(Date.now())` added to the existing 1-second interval at the end, after rate chart and events/sec updates. 1-second granularity is sufficient for slider position advancement and store cleanup.
- [x] **No deviations from the plan.** Implementation matches the plan exactly.

---

#### After Task 6 (Efficient replayTileEventsToMap)

_Record here: decisions about replay performance, map source update batching, max tile enforcement, and anything that impacts Task 7._

- [x] **Replay performance strategy:** `replayTileEventsToMap` clears `trackedTiles` and `removeAllDialogs()` first (no map source update), then replays all batches into the in-memory `trackedTiles` map, and only updates `SOURCE_ID` and `CROSS_SOURCE_ID` GeoJSON sources once at the end. This avoids N source updates for N batches — the key performance win over the Task 5 approach.
- [x] **`trackedTiles.clear()` interaction:** The function directly clears the module-level `trackedTiles` map and calls `removeAllDialogs()` without triggering a map source update (unlike `clearTiles()` which does update sources). This is intentional — the single source update at the end covers both the clear and the replay.
- [x] **MAX_TILES enforcement during replay:** After replaying all batches, the same oldest-first eviction logic from `addTileEventsToMap` is applied. Tiles are sorted by `addedAt` (which is set to `batch.time` during replay, not `Date.now()`) and the oldest are removed to stay under `MAX_TILES`.
- [x] **`addedAt` uses `batch.time` (not `Date.now()`):** During replay, `addedAt` is set to the batch's original timestamp. This is correct for historical replay — tiles are ordered by when they originally appeared, not when the replay ran. This differs from `addTileEventsToMap` which uses `Date.now()` for live updates.
- [x] **Auto-zoom during replay:** `fitMapToTiles()` is called once at the end if `autoZoomEnabled` is true, same as `addTileEventsToMap`. This means scrubbing the timeline will re-fit the map to the visible tiles at that point in time.
- [x] **`rebuildMapFromStore` simplified:** Now just calls `eventStore.getEventsUpTo(cutoffMs)` + `replayTileEventsToMap(batches)` — no more `clearTiles()` + loop. The `clearTiles` import is still needed for the "Clear Tiles" menu action.
- [x] **No deviations from the plan.** Implementation matches the plan exactly.

---

#### After Task 7 (Visual polish and edge cases)

_Record here: final decisions about edge case handling, Go Live button behavior, tooltip formatting, and any remaining follow-ups or known limitations._

- [ ] TODO — fill in after completing Task 7
