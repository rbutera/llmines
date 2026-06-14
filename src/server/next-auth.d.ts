import type { DefaultSession } from "next-auth";

/**
 * Module augmentation: expose the stable Google subject on `session.user.id`.
 *
 * The `jwt`/`session` callbacks in `auth.ts` forward `profile.sub` onto
 * `token.sub` and copy it to `session.user.id`. Typing it here lets the client
 * seam (RealAccountProvider) and the server token mint read `session.user.id`
 * without an unsafe cast.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
    } & DefaultSession["user"];
  }
}
