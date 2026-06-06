import { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { env } from "~/env";

/**
 * NextAuth (Google SSO) config for the REAL backend pass. Optional env vars keep
 * the mocked/test build valid; the production pass supplies real credentials.
 * The session callback surfaces the stable `sub` as `user.id` so the client seam
 * can mirror the server-derived identity.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: env.AUTH_GOOGLE_ID ?? "",
      clientSecret: env.AUTH_GOOGLE_SECRET ?? "",
    }),
  ],
  secret: env.AUTH_SECRET,
  callbacks: {
    session({ session, token }) {
      if (session.user && token.sub) {
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
  },
};
