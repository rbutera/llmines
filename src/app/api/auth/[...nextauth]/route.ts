import NextAuth from "next-auth";
import { authOptions } from "~/server/auth/config";

/**
 * NextAuth route handler (real-backend pass). Not exercised in TEST_MODE — the
 * mock auth seam drives sign-in/out there.
 */
// NextAuth v4's handler is typed loosely (any); this is the documented App
// Router pattern, so silence the unsafe-assignment lint on this boilerplate line.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
