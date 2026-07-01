/**
 * Convex auth configuration for the REAL pass (validates the RS256 JWT minted by
 * /api/convex-token so `ctx.auth.getUserIdentity()` is populated in production).
 *
 * Custom JWT mode: Convex verifies the token's signature against the public JWKS
 * below, which is embedded as a self-contained data: URI (no /api/auth/jwks
 * route to deploy, no fetch/cache concerns). The `issuer`/`applicationID` MUST
 * match the minted token's `iss`/`aud` (see src/server/convex-token-constants.ts)
 * and the Convex env vars CONVEX_AUTH_ISSUER_DOMAIN / CONVEX_AUTH_APPLICATION_ID.
 *
 * Not exercised in the eval harness: the mock provider supplies identity in
 * TEST_MODE, and `convex-test`'s `withIdentity(...)` supplies it in function
 * tests — neither needs a live issuer.
 */

// Public JWKS (kid=llmines-convex-1, RS256). The matching PKCS8 private key is
// the Worker secret CONVEX_TOKEN_PRIVATE_KEY. Base64 of:
//   {"keys":[{"kty":"RSA","n":"pl2_O...","e":"AQAB","kid":"llmines-convex-1","alg":"RS256","use":"sig"}]}
const JWKS_DATA_URI =
  "data:application/json;base64,eyJrZXlzIjpbeyJrdHkiOiJSU0EiLCJuIjoicThReDctdzVEMmIxaHo0RzZUWWQ2T2MteTJsS095RGtnb29ENTM2VXloR2hQUzRBRTdpUHRiQ1dMY0Jvd2ZrdmNQSTZrWndHRDlLY3NDbzZCS3EtdGxjaEVCMDhxY2hZMTFNWmpIcmtnX0NSNEc2YTRSNzRDUUYxQ3JjSnZGUl9fTG94RkQ3T25pVmw3MXc2TUV4Q0ZOeTdfU0FvLS1ndVpsNlQ0eTJ5eU9HSVFKNXl1bUFUaVdjVFdlSHYtMzh2dUxBMDJfSDBneGFkNVlkR2VKQkdIR3dMUkNFdlFaeDZQSUpmQ3dWUGs2VlJOdHVSb0RVeVl3ZHc1UzlMRkEzV1ZGd3lCdnE2T3BqaHNaYkpsRmF3ekdRTFE1NmdYRU90eEc4OUlLUzN1T0dtVGg2eGlIQmxDeXNrSEdBVV9nNXdLSTJJcENkRVpMYWpUT0d2YWVpQzh3IiwiZSI6IkFRQUIiLCJraWQiOiJsbG1pbmVzLWNvbnZleC0xIiwiYWxnIjoiUlMyNTYiLCJ1c2UiOiJzaWcifV19";

export default {
  providers: [
    {
      type: "customJwt" as const,
      // Pinned to the exact values the Worker signer mints (see
      // src/server/convex-token-constants.ts CONVEX_TOKEN_AUDIENCE / _ISSUER) and
      // the locked Convex deployment env (CONVEX_AUTH_APPLICATION_ID=convex,
      // CONVEX_AUTH_ISSUER_DOMAIN=https://llmines.e8n.dev). Literal, not
      // env-with-fallback: an env-driven value here could drift from the signer's
      // hard-coded aud/iss and fail validation silently. If these ever change,
      // change them in BOTH places (and the deployment env) together.
      applicationID: "convex",
      issuer: "https://llmines.e8n.dev",
      // Use the DOCUMENTED HTTPS JWKS route (Convex officially supports https jwks
      // URLs; the data: URI form is undocumented and can fail validation silently).
      // The route serves the identical key (CONVEX_JWKS) as JWKS_DATA_URI below, so
      // there is no drift (the data-URI const is retained as the drift-guard anchor).
      jwks: "https://llmines.e8n.dev/api/auth/jwks",
      algorithm: "RS256" as const,
    },
  ],
};
