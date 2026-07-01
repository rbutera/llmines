import "server-only";
import { SignJWT, importPKCS8 } from "jose";
import {
  CONVEX_TOKEN_ALG,
  CONVEX_TOKEN_AUDIENCE,
  CONVEX_TOKEN_ISSUER,
  CONVEX_TOKEN_KID,
  CONVEX_TOKEN_TTL_SECONDS,
} from "./convex-token-constants";

/**
 * Mints the short-lived RS256 JWT that Convex validates (Custom JWT mode) so
 * `ctx.auth.getUserIdentity()` resolves to the signed-in player. jose is
 * WebCrypto-based, so this runs on the Cloudflare Workers runtime.
 *
 * The private key (PKCS8 PEM) comes from the CONVEX_TOKEN_PRIVATE_KEY Worker
 * secret. We import it once and cache the CryptoKey at module scope — importing
 * per request is wasteful and pointless (the key never changes for a process).
 */
let cachedKey: Promise<CryptoKey> | null = null;

/**
 * Read the PKCS8 PEM signing key. On Cloudflare/OpenNext, Worker SECRETS live on
 * the Cloudflare context `env` binding; `process.env` is a shim that does NOT
 * reliably expose a MULTI-LINE secret (the PEM) — a single-line secret like
 * AUTH_SECRET comes through, but the multi-line PEM is dropped (keyPresent=false).
 * So prefer `getCloudflareContext().env`, falling back to `process.env` for local
 * dev / Node tests (where the Cloudflare context is absent).
 */
async function readPrivateKeyPem(): Promise<string | undefined> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as Record<string, string | undefined>;
    if (env?.CONVEX_TOKEN_PRIVATE_KEY) return env.CONVEX_TOKEN_PRIVATE_KEY;
  } catch {
    // not in a Cloudflare request context (local/Node) — fall through.
  }
  return process.env.CONVEX_TOKEN_PRIVATE_KEY;
}

function getPrivateKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  // importPKCS8 rejects -> the cached promise rejects; clear it so a later call
  // (e.g. after the secret is fixed) can retry rather than reusing the failure.
  cachedKey = (async () => {
    const pem = await readPrivateKeyPem();
    if (!pem) {
      throw new Error(
        "CONVEX_TOKEN_PRIVATE_KEY is not set; cannot mint a Convex token.",
      );
    }
    return importPKCS8(pem, CONVEX_TOKEN_ALG);
  })().catch((err) => {
    cachedKey = null;
    throw err;
  });
  return cachedKey;
}

export interface ConvexTokenClaims {
  /** Stable Google subject (raw `sub`) — must match existing scores/users rows. */
  subject: string;
  /** Required: convex/scores.ts + users.ts read identity.name. */
  name: string;
  /** Required: convex/users.ts reads identity.email. */
  email: string;
}

/**
 * Sign a Convex identity token for the given (server-derived) claims.
 * Header: { alg: RS256, kid: llmines-convex-1, typ: JWT }.
 * Payload: { iss, aud, sub, name, email, iat, exp(~10m) }.
 */
export async function mintConvexToken(
  claims: ConvexTokenClaims,
): Promise<string> {
  const key = await getPrivateKey();
  return new SignJWT({ name: claims.name, email: claims.email })
    .setProtectedHeader({
      alg: CONVEX_TOKEN_ALG,
      kid: CONVEX_TOKEN_KID,
      typ: "JWT",
    })
    .setIssuer(CONVEX_TOKEN_ISSUER)
    .setAudience(CONVEX_TOKEN_AUDIENCE)
    .setSubject(claims.subject)
    .setIssuedAt()
    .setExpirationTime(`${CONVEX_TOKEN_TTL_SECONDS}s`)
    .sign(key);
}
