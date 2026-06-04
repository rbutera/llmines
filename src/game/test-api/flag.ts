/**
 * Build-time-inlined test-mode flag. `NEXT_PUBLIC_*` vars are statically
 * replaced by Next in the client bundle, so when unset this resolves to a
 * constant `false` and the test-interface code path is never taken — no hooks
 * are exposed in a normal build.
 */
export const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === "1";
