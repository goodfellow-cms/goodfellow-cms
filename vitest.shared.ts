import { defineConfig } from "vitest/config";

/**
 * What every package's tests share. Vitest's own limits (5 seconds a test, 10
 * a hook) are too short on Windows while every package's tests run at once:
 * a test's first render, server or Node process can take that long to start.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
