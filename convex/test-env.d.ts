// Ambient typing for Vite's `import.meta.glob` used by convex-test, without
// depending on `vite/client` resolving under pnpm.
interface ImportMeta {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}
