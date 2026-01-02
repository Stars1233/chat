import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      // Map JSX runtime imports to our custom runtime
      "react/jsx-runtime": resolve(__dirname, "src/jsx-runtime.ts"),
      "react/jsx-dev-runtime": resolve(__dirname, "src/jsx-runtime.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
  },
});
