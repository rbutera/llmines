import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]),
    /**
     * NextAuth (Auth.js v5). Optional so the app builds/runs without auth
     * configured (e.g. the deterministic test build, which mocks auth). Auth.js
     * reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET for the Google provider and
     * AUTH_SECRET for JWT signing by convention.
     */
    AUTH_SECRET: z.string().optional(),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    /**
     * When set to "1", exposes the deterministic test interface
     * (`window.__lumines`) and pauses the audio-synced auto-loop. Unset in
     * normal/production builds — no test hooks are exposed.
     */
    NEXT_PUBLIC_TEST_MODE: z.enum(["0", "1"]).optional(),
    /**
     * Convex deployment URL for the real backend. Optional: unset in the
     * deterministic test build (which uses an in-memory mock), required for the
     * real-Convex production pass.
     */
    NEXT_PUBLIC_CONVEX_URL: z.string().url().optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
    NEXT_PUBLIC_TEST_MODE: process.env.NEXT_PUBLIC_TEST_MODE,
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
