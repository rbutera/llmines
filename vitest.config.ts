import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Logic core is pure; jsdom only needed where DOM is touched. Default to node.
    environment: "node",
    // App unit tests + Convex function tests (the latter run the REAL schema +
    // functions in-memory via convex-test).
    include: ["src/**/*.test.ts", "convex/**/*.test.ts"],
    globals: false,
    server: {
      // convex-test ships ESM that must be transformed by Vite, not externalised.
      deps: { inline: ["convex-test"] },
    },
  },
});
