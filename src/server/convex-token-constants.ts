/**
 * Single source of truth for the minted Convex token's signing parameters.
 *
 * These MUST match (1) the RS256 keypair whose private half is the Worker secret
 * CONVEX_TOKEN_PRIVATE_KEY, (2) the public JWKS in convex/auth.config.ts, and
 * (3) the Convex deployment env (CONVEX_AUTH_ISSUER_DOMAIN / *_APPLICATION_ID).
 * Drift between any of these breaks `ctx.auth.getUserIdentity()` silently.
 */

/** Key id; must equal the `kid` of the published JWKS key. */
export const CONVEX_TOKEN_KID = "llmines-convex-1";

/** Signing algorithm. Convex Custom JWT supports RS256 / ES256. */
export const CONVEX_TOKEN_ALG = "RS256" as const;

/**
 * Issuer; equals CONVEX_AUTH_ISSUER_DOMAIN set on the Convex deployment and the
 * `issuer` in convex/auth.config.ts.
 */
export const CONVEX_TOKEN_ISSUER = "https://llmines.e8n.dev";

/**
 * Audience; equals CONVEX_AUTH_APPLICATION_ID on Convex and the `applicationID`
 * in convex/auth.config.ts.
 */
export const CONVEX_TOKEN_AUDIENCE = "convex";

/** Minted token lifetime (~10 minutes); re-minted on force-refresh. */
export const CONVEX_TOKEN_TTL_SECONDS = 10 * 60;

/**
 * The PUBLIC half of the RS256 signing key, as a JWK. The matching PKCS8 private
 * key is the Worker secret CONVEX_TOKEN_PRIVATE_KEY. Convex verifies minted
 * tokens against this (via the JWKS in convex/auth.config.ts).
 *
 * NOTE: convex/auth.config.ts embeds this same key as a base64 data: URI (it is
 * bundled separately by `convex deploy` and cannot import from src/). The test
 * `convex-token.test.ts` asserts the data: URI decodes to exactly this JWK, so
 * the two cannot drift. The `/api/auth/jwks` route also serves this object, as a
 * documented HTTPS fallback if a Convex deployment rejects a data: URI JWKS.
 */
export const CONVEX_PUBLIC_JWK = {
  kty: "RSA",
  n: "pl2_OPkGWvUX_Sy9MBxtHGNC2KYdPaRmKV5Ad9_1PK7SBxOamwJ3vAsZUXYiK1SyfVF-vPj0ULmapoO_fURC5Jce03ByK0ebc_MfJ63i5djC4cb4REROCVf2aPp9yJGeehmik1uJoAWCeAfxrLi5Hp2ipUnKhjn_jB3I1WS5HS3FQXtd9qaMrQpAvX216QZaucKmT_lQl5BgSqjx-I9Z6QHuPKYeHi5WwtEqH6tOTXJ91Y5hP9Ty3yx4ys6DnoS1gYVNX5FweYXIxhzkW_PFiRfwaQUny2Fsgq10NbqXLXwwgE-FDrZfVaRAYEXy06AA3JPTkQKSh9Wij1dAy7vqAQ",
  e: "AQAB",
  kid: CONVEX_TOKEN_KID,
  alg: CONVEX_TOKEN_ALG,
  use: "sig",
} as const;

/** The JWKS document Convex consumes (route + data: URI both serve this). */
export const CONVEX_JWKS = { keys: [CONVEX_PUBLIC_JWK] } as const;
