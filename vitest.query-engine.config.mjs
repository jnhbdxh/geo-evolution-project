import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/query-engine/**/*.browser.integration.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
