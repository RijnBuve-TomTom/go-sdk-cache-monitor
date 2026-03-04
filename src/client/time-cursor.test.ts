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
