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
