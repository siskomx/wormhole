import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    // Process-heavy fake LSP and SQLite tests are timing-sensitive on Windows under default parallelism.
    ...(process.platform === "win32" ? { maxWorkers: 2 } : {}),
  },
});
