import { type DefaultSession, type NextAuthConfig } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

/**
 * Module augmentation so `session.user.id` (the stable subject) is typed. The
 * leaderboard derives the user from this server-side, never from a client arg.
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

/**
 * NextAuth (Auth.js v5) configuration — Google SSO with stateless JWT sessions
 * (no database adapter needed). Provider credentials are read from the
 * environment (`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`). This is the REAL auth
 * layer; the deterministic mock used in tests/eval does not touch it.
 */
export const authConfig = {
  providers: [GoogleProvider],
  session: { strategy: "jwt" },
  callbacks: {
    session: ({ session, token }) => ({
      ...session,
      user: {
        ...session.user,
        id: token.sub ?? session.user.id,
      },
    }),
  },
} satisfies NextAuthConfig;
