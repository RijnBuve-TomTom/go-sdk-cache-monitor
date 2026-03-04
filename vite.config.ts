import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "src/client",
  publicDir: resolve(__dirname, "public"),
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
