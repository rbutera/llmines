import { NextResponse } from "next/server";
import { auth } from "../../../server/auth";
import { mintConvexToken } from "../../../server/convex-token";

/**
 * POST /api/convex-token — mints the RS256 JWT that Convex validates for the
 * CURRENTLY signed-in player.
 *
 * Security: the subject/name/email are derived ONLY from the server session via
 * `auth()`. There is NO request body or query param read — a caller cannot
 * specify whose token to mint, so this is not an identity-spoof surface.
 *
 * No `runtime` override: OpenNext runs this on the Worker (jose is WebCrypto).
 */
export async function POST() {
  const session = await auth();
  const user = session?.user;
  const subject = user?.id;

  // TEMP DIAGNOSTIC (remove after auth bridge confirmed): surfaces in `wrangler
  // tail` whether auth() resolved the session + whether user.id (the Convex sub)
  // is present, to pinpoint why getUserIdentity is null.
  console.log(
    `[convex-token] session=${!!session} user=${!!user} hasId=${!!subject} sub=${subject ? String(subject).slice(0, 6) + "…" : "none"}`,
  );

  if (!subject) {
    return new NextResponse(null, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  let token: string;
  try {
    token = await mintConvexToken({
      subject,
      // name/email are required claims; fall back so the token is always valid
      // even for the (rare) Google account missing a name/email.
      name: user.name ?? "Player",
      email: user.email ?? "",
    });
  } catch (e) {
    // TEMP DIAGNOSTIC: surface the mint error type (no key material) so we can
    // see WHY signing fails on the Workers runtime (missing env vs PEM parse).
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const keyPresent = !!process.env.CONVEX_TOKEN_PRIVATE_KEY;
    const keyLen = process.env.CONVEX_TOKEN_PRIVATE_KEY?.length ?? 0;
    console.log(`[convex-token] MINT FAILED keyPresent=${keyPresent} keyLen=${keyLen} ${detail}`);
    return new NextResponse(
      JSON.stringify({ error: detail, keyPresent, keyLen }),
      { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
    );
  }

  return new NextResponse(JSON.stringify({ token }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
