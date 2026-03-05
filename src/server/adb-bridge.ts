import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { parseLogcatLine } from "./logcat-parser.js";
import type { CacheMonitorMessage } from "../shared/types.js";

export interface AdbBridgeEvents {
  message: [CacheMonitorMessage];
  connected: [string]; // deviceId
  disconnected: [];
  error: [Error];
}

/**
 * Spawns `adb logcat -s CacheMonitor:D -s CacheMonitorIntegration:D` and emits parsed messages.
 * Automatically reconnects on disconnect.
 */
export class AdbBridge extends EventEmitter<AdbBridgeEvents> {
  private proc: ChildProcess | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private devicePollTimer: ReturnType<typeof setTimeout> | null = null;
  private deviceConnected = false;
  private stopped = false;

  constructor(
    private readonly adbPath = "adb",
    private readonly devicePollIntervalMs = 2000
  ) {
    super();
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    this.clearDevicePolling();
    this.deviceConnected = false;
    this.killProcess();
  }

  private connect(): void {
    this.clearDevicePolling();
    this.killProcess();

    console.log("[adb] Spawning: adb logcat -s CacheMonitor:D CacheMonitorIntegration:D");

    this.proc = spawn(this.adbPath, ["logcat", "-s", "CacheMonitor:D", "CacheMonitorIntegration:D"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const rl = createInterface({ input: this.proc.stdout! });

    rl.on("line", (line) => {
      const msg = parseLogcatLine(line);
      if (msg) {
        this.emit("message", msg);
      }
    });

    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        console.error("[adb stderr]", text);
      }
    });

    this.proc.on("error", (err) => {
      console.error("[adb] Process error:", err.message);
      this.emit("error", err);
      this.scheduleReconnect();
    });

    this.proc.on("close", (code) => {
      console.log("[adb] Process exited with code", code);
      this.emit("disconnected");
      this.scheduleReconnect();
    });

    // Check device connectivity
    this.checkDevice();
  }

  private async checkDevice(): Promise<void> {
    const check = spawn(this.adbPath, ["devices", "-l"]);
    let output = "";
    check.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    check.on("close", () => {
      const lines = output
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("List of"));

      if (lines.length > 0) {
        const deviceId = lines[0].split(/\s+/)[0];
        const state = lines[0].split(/\s+/)[1];

        if (state !== "unauthorized") {
          console.log("[adb] Device found:", deviceId);
          this.deviceConnected = true;
          this.emit("connected", deviceId);
        }
      } else {
        console.log("[adb] No device found");
        this.deviceConnected = false;
        this.emit("disconnected");
      }

      // Start continuous polling
      this.startDevicePolling();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.clearReconnect();
    console.log("[adb] Reconnecting in 3 seconds...");
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearDevicePolling(): void {
    if (this.devicePollTimer) {
      clearTimeout(this.devicePollTimer);
      this.devicePollTimer = null;
    }
  }

  private startDevicePolling(): void {
    if (this.stopped) return;

    this.devicePollTimer = setTimeout(() => {
      this.pollDevice();
    }, this.devicePollIntervalMs);
  }

  private async pollDevice(): Promise<void> {
    if (this.stopped) return;

    const check = spawn(this.adbPath, ["devices", "-l"]);
    let output = "";

    check.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    check.on("close", () => {
      const lines = output
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("List of"));

      const hasDevice = lines.length > 0;
      const wasConnected = this.deviceConnected;

      // Warn about multiple devices
      if (lines.length > 1) {
        console.warn(`[adb] Multiple devices detected (${lines.length}), using first one`);
      }

      if (hasDevice && !wasConnected) {
        // Device just connected
        const deviceId = lines[0].split(/\s+/)[0];
        const state = lines[0].split(/\s+/)[1];

        if (state === "unauthorized") {
          console.warn(`[adb] Device ${deviceId} is unauthorized - please check device for authorization prompt`);
        } else {
          console.log("[adb] Device connected:", deviceId);
          this.deviceConnected = true;
          this.emit("connected", deviceId);
        }
      } else if (!hasDevice && wasConnected) {
        // Device just disconnected
        console.log("[adb] Device disconnected");
        this.deviceConnected = false;
        this.emit("disconnected");
      }

      // Schedule next poll
      this.startDevicePolling();
    });

    check.on("error", (err) => {
      console.error("[adb] Device poll error:", err.message);
      this.startDevicePolling(); // Continue polling even on error
    });
  }

  private killProcess(): void {
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
  }
}
