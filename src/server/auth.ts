import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

/**
 * NextAuth (v4) options for the REAL auth pass: Google SSO with a JWT session.
 *
 * Credential-gated: this is inert without AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET /
 * AUTH_SECRET set (the provider list is empty, so sign-in is a no-op). The mock
 * / TEST_MODE path never imports this. To go live:
 *   1. Create a Google OAuth client (Web) with the deployed origin as an
 *      authorized redirect URI: `<origin>/api/auth/callback/google`.
 *   2. Set AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET / AUTH_SECRET.
 *   3. Configure Convex Auth (convex/auth.config.ts) to trust this issuer so
 *      `ctx.auth.getUserIdentity()` is populated server-side.
 *
 * Privacy: we forward only the stable `sub`, the `email`, and the display `name`
 * (used at sign-in to suggest a username, never persisted). No avatar URL or
 * other Google profile fields are propagated into the session.
 */
const googleConfigured =
  !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_GOOGLE_SECRET;

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  providers: googleConfigured
    ? [
        GoogleProvider({
          clientId: process.env.AUTH_GOOGLE_ID!,
          clientSecret: process.env.AUTH_GOOGLE_SECRET!,
        }),
      ]
    : [],
  callbacks: {
    // Carry the stable Google subject through to the session so the client can
    // derive a consistent `subject`. Convex independently validates the JWT and
    // derives identity server-side; this is only for the client-side seam.
    jwt({ token, profile }) {
      if (profile && "sub" in profile && typeof profile.sub === "string") {
        token.sub = profile.sub;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
  },
};
