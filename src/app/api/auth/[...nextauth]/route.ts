import { handlers } from "../../../../server/auth";

/**
 * Auth.js v5 App Router handler for the real Google SSO pass. Inert until the
 * AUTH_GOOGLE_* / AUTH_SECRET env vars are set (see src/server/auth.ts) — the
 * mock / TEST_MODE build never hits this route.
 *
 * No `runtime` override: OpenNext runs this on the Worker, where v5's
 * fetch-based core (oauth4webapi + jose) is native.
 */
export const { GET, POST } = handlers;
