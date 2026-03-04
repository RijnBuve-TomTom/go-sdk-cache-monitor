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
  private stopped = false;

  constructor(private readonly adbPath = "adb") {
    super();
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    this.killProcess();
  }

  private connect(): void {
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
        console.log("[adb] Device found:", deviceId);
        this.emit("connected", deviceId);
      }
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

  private killProcess(): void {
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
  }
}
