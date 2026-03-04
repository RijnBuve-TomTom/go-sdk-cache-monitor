import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// Read config.properties for the TomTom API key
function loadProperties(filePath: string): Record<string, string> {
  const props: Record<string, string> = {};
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        props[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
      }
    }
  } catch {
    console.warn(`[vite] Could not read ${filePath}, using defaults`);
  }
  return props;
}

const props = loadProperties(resolve(__dirname, "config.properties"));

export default defineConfig({
  root: "src/client",
  publicDir: resolve(__dirname, "public"),
  define: {
    __TOMTOM_API_KEY__: JSON.stringify(props["tomtom.api.key"] ?? ""),
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/client"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
});
