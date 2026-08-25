import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@geo-os/contracts": fileURLToPath(
        new URL("./packages/contracts/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["apps/api/src/*.queue.integration.ts", "tests/*.queue.integration.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    fileParallelism: false,
  },
});
