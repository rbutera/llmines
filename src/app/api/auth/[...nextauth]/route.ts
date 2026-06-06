import NextAuth from "next-auth";

import { authOptions } from "~/server/auth";

type RouteHandler = (request: Request) => Promise<Response>;

const handler = NextAuth(authOptions) as RouteHandler;

export { handler as GET, handler as POST };
