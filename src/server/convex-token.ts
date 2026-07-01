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
 *
 * We read from the Cloudflare env binding via the ASYNC form of
 * `getCloudflareContext`. The SYNC form throws when called at the top level or in
 * a statically-evaluated context, and a previous version swallowed that throw
 * silently — which dropped us to `process.env` (empty for the PEM) and made the
 * mint fail with "not set". The async form is valid in more contexts; we log each
 * path's outcome so a runtime failure is diagnosable from `wrangler tail`.
 */
async function readPrivateKeyPem(): Promise<string | undefined> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    const v = (env as Record<string, string | undefined>)?.CONVEX_TOKEN_PRIVATE_KEY;
    console.log(
      `[convex-token] readKey gcc keyPresent=${!!v} keyLen=${v?.length ?? 0}`,
    );
    if (v) return v;
  } catch (e) {
    console.log(
      `[convex-token] readKey gcc threw: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`,
    );
  }
  const pe = process.env.CONVEX_TOKEN_PRIVATE_KEY;
  console.log(
    `[convex-token] readKey processEnv keyPresent=${!!pe} keyLen=${pe?.length ?? 0}`,
  );
  return pe;
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
