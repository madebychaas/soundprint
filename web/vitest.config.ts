import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The integration test analyses real audio through the Python service.
    testTimeout: 60_000,
    hookTimeout: 240_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
