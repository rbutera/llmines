import { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * NextAuth (Auth.js v5) configuration — Google SSO with stateless JWT sessions
 * (no database adapter; Convex is the only persistence and is used for scores,
 * not auth). The Google provider reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET from
 * the environment.
 *
 * The `sub` (subject) and profile name/image are carried in the JWT and surfaced
 * on the session so the client can show the signed-in user. `sub` is the stable
 * identity the server derives the player from when writing scores — it is never
 * a client-trusted value.
 */
export const authConfig = {
  providers: [Google],
  session: { strategy: "jwt" },
} satisfies NextAuthConfig;
