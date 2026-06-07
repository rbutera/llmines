import { handlers } from "~/server/auth";

/**
 * NextAuth (Auth.js v5) route handlers for the App Router. Real auth path only;
 * the deterministic mock/eval path never hits this route.
 */
export const { GET, POST } = handlers;
