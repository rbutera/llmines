import { NextResponse } from "next/server";
import { CONVEX_JWKS } from "../../../../server/convex-token-constants";

/**
 * GET /api/auth/jwks — the PUBLIC JWKS for the Convex token signer.
 *
 * The active Convex config (convex/auth.config.ts) currently embeds this same
 * key as a self-contained `data:` URI (no fetch). This HTTPS route is the
 * documented, guaranteed-supported fallback: if a Convex deployment rejects a
 * `data:` URI JWKS, point `jwks` at `https://llmines.e8n.dev/api/auth/jwks`
 * instead — it serves the identical key (CONVEX_JWKS), so there is no drift.
 *
 * Public + cacheable: it is a public key. No `runtime` override (OpenNext owns
 * the runtime on the Worker).
 */
export function GET() {
  return NextResponse.json(CONVEX_JWKS, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
