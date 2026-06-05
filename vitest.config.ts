import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Logic core is pure; convex-test runs the real backend in-memory (node).
    environment: "node",
    include: ["src/**/*.test.ts", "convex/**/*.test.ts"],
    globals: false,
    server: { deps: { inline: ["convex-test"] } },
  },
});
