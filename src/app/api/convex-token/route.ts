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

  if (!subject) {
    return new NextResponse(null, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const token = await mintConvexToken({
    subject,
    // name/email are required claims; fall back so the token is always valid
    // even for the (rare) Google account missing a name/email.
    name: user.name ?? "Player",
    email: user.email ?? "",
  });

  return new NextResponse(JSON.stringify({ token }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
