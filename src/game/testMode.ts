// Build-time flag. NEXT_PUBLIC_* vars are statically inlined by Next, so when
// the flag is unset this constant folds to `false` and every guarded test-only
// branch is dead-code-eliminated from the production bundle.
export const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === "1";
