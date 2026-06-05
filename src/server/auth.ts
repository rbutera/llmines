import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { env } from "~/env";

/**
 * NextAuth (Auth.js v5) with Google SSO. Credentials are optional env vars so
 * the app builds without them in eval; the real values are supplied in the
 * production pass. Exercised only by the non-TEST_MODE (real) provider.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
    }),
  ],
  secret: env.AUTH_SECRET,
});
