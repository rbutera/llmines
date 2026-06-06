import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Logic core is pure; jsdom only needed where DOM is touched. Default to node.
    environment: "node",
    // Unit tests live under src/**; Convex function tests (convex-test) under convex/**.
    include: ["src/**/*.test.ts", "convex/**/*.test.ts"],
    // convex-test must be inlined so its in-memory backend + import.meta.glob work.
    server: { deps: { inline: ["convex-test"] } },
    globals: false,
  },
});
