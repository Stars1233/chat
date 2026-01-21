import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use 'vmThreads' pool to avoid tinypool worker cleanup issues
    pool: "vmThreads",
    // Increase test timeout for readme tests that run tsc
    testTimeout: 30000,
  },
});
