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
