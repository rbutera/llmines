import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Logic core is pure; jsdom only needed where DOM is touched. Default to node.
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
