/**
 * Convex auth configuration for the REAL pass only (validates the NextAuth-
 * issued JWT so `ctx.auth.getUserIdentity()` is populated in production).
 *
 * Not exercised in the eval harness: the mock provider supplies identity in
 * TEST_MODE, and `convex-test`'s `withIdentity(...)` supplies it in function
 * tests — neither needs a live issuer. Fill `CONVEX_AUTH_*` env in the real
 * pass (top-2 cells); offline this is inert scaffolding.
 */
export default {
  providers: [
    {
      // e.g. your NextAuth issuer URL; placeholder for the real pass.
      domain: process.env.CONVEX_AUTH_ISSUER_DOMAIN ?? "https://example.com",
      applicationID: process.env.CONVEX_AUTH_APPLICATION_ID ?? "convex",
    },
  ],
};
