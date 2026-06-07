/**
 * Convex auth provider configuration for the REAL deployment. This wires Convex
 * `ctx.auth.getUserIdentity()` to the NextAuth-issued JWT (Google SSO). It is
 * read by the Convex backend at deploy time and is NOT bundled into the app nor
 * exercised by the deterministic mock used in tests/eval.
 *
 * Values come from environment variables on the Convex deployment:
 *  - CONVEX_AUTH_ISSUER: the token issuer (e.g. your NextAuth/Auth.js domain)
 *  - CONVEX_AUTH_APPLICATION_ID: the audience/application id
 */
export default {
  providers: [
    {
      domain: process.env.CONVEX_AUTH_ISSUER ?? "https://example.com",
      applicationID: process.env.CONVEX_AUTH_APPLICATION_ID ?? "convex",
    },
  ],
};
