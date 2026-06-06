import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { env } from "~/env";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID ?? "missing-google-client-id",
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? "missing-google-client-secret",
    }),
  ],
  session: { strategy: "jwt" },
  secret:
    env.NEXTAUTH_SECRET ??
    (process.env.NEXT_PUBLIC_TEST_MODE === "1"
      ? "llmines-nextauth-test-secret"
      : undefined),
  callbacks: {
    session: ({ session, token }) => ({
      ...session,
      user: session.user
        ? {
            ...session.user,
            id: token.sub,
          }
        : session.user,
    }),
  },
};
