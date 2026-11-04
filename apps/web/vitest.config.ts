import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname,
      // Next's "server-only" poison-pill throws under plain Node; stub it the
      // same way the evals config does so unit tests don't each need
      // vi.mock("server-only", ...).
      "server-only": `${import.meta.dirname}/evals/stubs/server-only.ts`,
    },
  },
  test: {
    // Keep stale full-repo copies under .claude/ (agent worktrees) out of the
    // suite; everything else keeps Vitest's default resolution semantics.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
