import { defineConfig } from "vitest/config";

// The game core is pure (no DOM), so a node environment is sufficient.
// `resolve.tsconfigPaths` resolves the `~/*` -> `./src/*` alias from tsconfig.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
