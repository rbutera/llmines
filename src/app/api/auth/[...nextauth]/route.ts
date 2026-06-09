import NextAuth from "next-auth";
import { authOptions } from "../../../../server/auth";

/**
 * NextAuth (v4) App Router handler for the real Google SSO pass. Inert until the
 * AUTH_GOOGLE_* / AUTH_SECRET env vars are set (see src/server/auth.ts) — the
 * mock / TEST_MODE build never hits this route.
 */
// NextAuth v4's App Router handler is typed as `any`; this is the documented
// idiom for the route, so the unsafe-assignment rule is disabled for it.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
