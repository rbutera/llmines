import NextAuth, { type NextAuthConfig } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

/**
 * Auth.js v5 (NextAuth) config for the REAL auth pass: Google SSO with a JWT
 * session. v5 core (oauth4webapi + jose) is fetch/WebCrypto based, so the Google
 * handshake runs natively on the Cloudflare Workers (OpenNext) runtime — v4's
 * openid-client Node-http dependency was the `OAuthSignin` defect.
 *
 * Credential-gated: this is inert without AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
 * set (the provider list is empty, so sign-in is a no-op). The mock / TEST_MODE
 * path never imports this. To go live:
 *   1. Create a Google OAuth client (Web) with the deployed origin as an
 *      authorized redirect URI: `<origin>/api/auth/callback/google`.
 *   2. Set AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET / AUTH_SECRET (Worker secrets).
 *   3. Configure Convex Auth (convex/auth.config.ts) to trust the minted RS256
 *      token's issuer so `ctx.auth.getUserIdentity()` is populated server-side.
 *
 * Privacy: we forward only the stable `sub`, the `email`, and the display `name`
 * (used at sign-in to suggest a username, never persisted). No avatar URL or
 * other Google profile fields are propagated into the session.
 */
const googleConfigured =
  !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_GOOGLE_SECRET;

export const authConfig: NextAuthConfig = {
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  // Workers/OpenNext is not auto-trusted; Auth.js v5 must trust the forwarded
  // host to build callback URLs behind the Cloudflare proxy.
  trustHost: true,
  providers: googleConfigured
    ? [
        GoogleProvider({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
        }),
      ]
    : [],
  callbacks: {
    // Carry the stable Google subject through to the session so the client can
    // derive a consistent `subject`, AND so /api/convex-token can mint a token
    // whose `sub` matches existing scores/users rows. Convex independently
    // validates the minted JWT and derives identity server-side.
    jwt({ token, profile }) {
      if (profile && typeof profile.sub === "string") {
        token.sub = profile.sub;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
