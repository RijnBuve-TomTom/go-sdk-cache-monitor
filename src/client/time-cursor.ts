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
