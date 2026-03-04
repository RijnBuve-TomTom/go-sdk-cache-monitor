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

- [ ] TODO — fill in after completing Task 2

---

#### After Task 3 (Timeline slider HTML and CSS)

_Record here: decisions about DOM structure, CSS variable usage, layout positioning relative to the rate chart, and anything that impacts Tasks 4–7._

- [ ] TODO — fill in after completing Task 3

---

#### After Task 4 (TimelineSlider interaction module)

_Record here: decisions about pointer event handling, coordinate-to-time mapping, touch support approach, and anything that impacts Tasks 5–7._

- [ ] TODO — fill in after completing Task 4

---

#### After Task 5 (Wire EventStore and TimeCursor into main.ts)

_Record here: decisions about integration points, gating logic for live vs historical mode, interval timing, and anything that impacts Tasks 6–7._

- [ ] TODO — fill in after completing Task 5

---

#### After Task 6 (Efficient replayTileEventsToMap)

_Record here: decisions about replay performance, map source update batching, max tile enforcement, and anything that impacts Task 7._

- [ ] TODO — fill in after completing Task 6

---

#### After Task 7 (Visual polish and edge cases)

_Record here: final decisions about edge case handling, Go Live button behavior, tooltip formatting, and any remaining follow-ups or known limitations._

- [ ] TODO — fill in after completing Task 7
