import type { CacheMonitorMessage } from "../shared/types.js";

/**
 * Parses a raw logcat line into a CacheMonitorMessage, or returns null
 * if the line is not a valid CacheMonitor JSON message.
 *
 * Expected logcat format:
 *   D CacheMonitor: {"type":"tileBatch", ...}
 * or with PID/TID:
 *   03-05 12:34:56.789  1234  5678 D CacheMonitor: {"type":"tileBatch", ...}
 */
export function parseLogcatLine(
  raw: string,
): CacheMonitorMessage | null {
  const line = raw.trim();
  if (!line) return null;

  // Find the JSON payload — look for the first '{' character
  const jsonStart = line.indexOf("{");
  if (jsonStart === -1) return null;

  const jsonStr = line.slice(jsonStart);

  try {
    const parsed = JSON.parse(jsonStr);

    // Validate it's one of our three message types
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.type === "string" &&
      typeof parsed.time === "number" &&
      (parsed.type === "tileBatch" ||
        parsed.type === "cacheStats" ||
        parsed.type === "cacheEvent")
    ) {
      return parsed as CacheMonitorMessage;
    }
  } catch {
    // Not valid JSON — ignore
  }

  return null;
}
