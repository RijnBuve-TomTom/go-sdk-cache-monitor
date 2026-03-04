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
