import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig sets `jsx: "preserve"` (Next handles JSX in the app build). Vite 8's
  // transformer (oxc) inherits that from tsconfig, so its import-analysis cannot
  // parse a .tsx left in preserve form — a unit test that imports a PURE helper
  // out of a .tsx (e.g. `shearFactor` from Cube.tsx) then fails to transform.
  // Override the JSX runtime to "automatic" here so those .tsx modules parse in
  // the test environment. The Next app build (which owns JSX) is unaffected.
  oxc: { jsx: { runtime: "automatic" } },
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
