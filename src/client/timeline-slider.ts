// src/client/timeline-slider.ts
import type { TimeCursor } from "./time-cursor";

export interface TimelineSliderElements {
  track: HTMLElement;
  thumb: HTMLElement;
  elapsed: HTMLElement;
  labelCursor: HTMLElement;
}

export interface TimelineMarker {
  time: number;
  type: "flush" | "corruption";
  label: string;
  el: HTMLElement;
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
  private markers: TimelineMarker[] = [];

  constructor(els: TimelineSliderElements, cursor: TimeCursor) {
    this.els = els;
    this.cursor = cursor;
    this.bindEvents();
    this.updatePosition(); // start at live (right edge)
  }

  /** Call this on every animation frame or 1s tick to keep "now" advancing. */
  tick(now: number): void {
    this.latestNow = now;
    this.pruneMarkers();
    this.updateMarkerPositions();
    if (this.cursor.isLive()) {
      this.updatePosition();
    }
  }

  /** Add an event marker (flush or corruption) to the timeline. */
  addMarker(time: number, type: "flush" | "corruption", label: string): void {
    const el = document.createElement("div");
    el.className = `timeline-marker timeline-marker-${type}`;
    el.title = label;
    this.els.track.appendChild(el);
    this.markers.push({ time, type, label, el });
    this.updateMarkerPositions();
  }

  /** Remove markers that have scrolled out of the visible time window. */
  private pruneMarkers(): void {
    // Keep all markers — the timeline covers the entire capture duration
  }

  /** Reposition all marker elements based on their timestamp. */
  private updateMarkerPositions(): void {
    const rangeStart = this.latestNow - this.timeRangeMs;
    const rangeEnd = this.latestNow;
    const span = rangeEnd - rangeStart;
    if (span <= 0) return;

    for (const m of this.markers) {
      let frac = (m.time - rangeStart) / span;
      frac = Math.max(0, Math.min(1, frac));
      m.el.style.left = `${(frac * 100).toFixed(2)}%`;
    }
  }

  /** Set the visible time window (e.g. 60_000 for 60s). */
  setTimeRange(ms: number): void {
    this.timeRangeMs = ms;
  }

  /** Update the thumb position and labels from the cursor state. */
  updatePosition(): void {
    // If no events yet, keep the thumb at the right edge
    if (this.timeRangeMs <= 0) return;

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
      this.els.thumb.title = "Live — drag to travel in time";
    } else {
      const deltaS = ((cursorTime - this.latestNow) / 1000).toFixed(0);
      this.els.labelCursor.textContent = `${deltaS}s`;
      const date = new Date(cursorTime);
      this.els.thumb.title = date.toLocaleTimeString("en-US", { hour12: false });
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
