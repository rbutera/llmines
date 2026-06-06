import NextAuth from "next-auth";
import { authConfig } from "./config";

/**
 * The NextAuth singleton. `handlers` powers the /api/auth route; `auth` reads
 * the session server-side; `signIn`/`signOut` are server actions.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
