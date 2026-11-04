import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Simulation evals: real model calls against the real agent. Kept out of the
// unit-test config on purpose — run explicitly with `npm run eval:agent`.
export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname,
      "next/server": resolve(import.meta.dirname, "evals/stubs/next-server.ts"),
      "server-only": resolve(import.meta.dirname, "evals/stubs/server-only.ts"),
    },
  },
  test: {
    fileParallelism: false,
    hookTimeout: 120_000,
    include: ["evals/**/*.eval.ts"],
    maxConcurrency: 1,
    setupFiles: ["evals/setup.ts"],
    testTimeout: 600_000,
  },
});
