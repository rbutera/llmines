import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions: NextAuthOptions = {
  secret:
    process.env.NEXTAUTH_SECRET ??
    (process.env.NEXT_PUBLIC_TEST_MODE === "1"
      ? "llmines-test-nextauth-secret"
      : undefined),
  providers:
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : [],
  callbacks: {
    jwt({ token, account }) {
      if (account?.id_token) {
        token.convexToken = account.id_token;
      }
      return token;
    },
    session({ session, token }) {
      session.convexToken =
        typeof token.convexToken === "string" ? token.convexToken : undefined;
      if (session.user) {
        session.user.id = token.sub ?? token.email ?? undefined;
      }
      return session;
    },
  },
};
