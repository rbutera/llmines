import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: "https://accounts.google.com",
      applicationID: process.env.GOOGLE_CLIENT_ID ?? "mock-google-client-id",
    },
  ],
} satisfies AuthConfig;
