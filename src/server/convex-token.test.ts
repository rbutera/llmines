import {
  type JWK,
  exportPKCS8,
  exportJWK,
  generateKeyPair,
  jwtVerify,
} from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONVEX_TOKEN_AUDIENCE,
  CONVEX_TOKEN_ISSUER,
  CONVEX_TOKEN_KID,
} from "./convex-token-constants";

// A throwaway RS256 keypair for the test; we inject the private half as the
// CONVEX_TOKEN_PRIVATE_KEY env the signer reads, and verify against the public.
let publicJwk: JWK;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  process.env.CONVEX_TOKEN_PRIVATE_KEY = await exportPKCS8(privateKey);
  publicJwk = await exportJWK(publicKey);
  publicJwk.alg = "RS256";
  publicJwk.kid = CONVEX_TOKEN_KID;
});

afterEach(() => vi.resetModules());

describe("mintConvexToken", () => {
  it("mints a token with the correct header (alg/kid/typ) and claims", async () => {
    const { mintConvexToken } = await import("./convex-token");
    const token = await mintConvexToken({
      subject: "g|abc123",
      name: "Mark Jacobs",
      email: "mark@example.com",
    });

    const key = await import("jose").then((j) => j.importJWK(publicJwk, "RS256"));
    const { payload, protectedHeader } = await jwtVerify(token, key, {
      issuer: CONVEX_TOKEN_ISSUER,
      audience: CONVEX_TOKEN_AUDIENCE,
    });

    // Header
    expect(protectedHeader.alg).toBe("RS256");
    expect(protectedHeader.kid).toBe(CONVEX_TOKEN_KID);
    expect(protectedHeader.typ).toBe("JWT");

    // Claims
    expect(payload.iss).toBe(CONVEX_TOKEN_ISSUER);
    expect(payload.aud).toBe(CONVEX_TOKEN_AUDIENCE);
    expect(payload.sub).toBe("g|abc123"); // raw Google sub, matches scores rows
    expect(payload.name).toBe("Mark Jacobs"); // REQUIRED: scores save "Anonymous" without it
    expect(payload.email).toBe("mark@example.com");

    // Timing: ~10 minutes, iat set.
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
    const ttl = payload.exp! - payload.iat!;
    expect(ttl).toBe(600);
  });

  it("always carries a `name` claim (so scores never default to Anonymous)", async () => {
    const { mintConvexToken } = await import("./convex-token");
    const token = await mintConvexToken({
      subject: "g|noname",
      name: "Player",
      email: "",
    });
    const key = await import("jose").then((j) => j.importJWK(publicJwk, "RS256"));
    const { payload } = await jwtVerify(token, key);
    expect(payload.name).toBe("Player");
    expect(payload.name).toBeTruthy();
  });

  it("throws when the signing key is not configured", async () => {
    const saved = process.env.CONVEX_TOKEN_PRIVATE_KEY;
    delete process.env.CONVEX_TOKEN_PRIVATE_KEY;
    vi.resetModules();
    const { mintConvexToken } = await import("./convex-token");
    await expect(
      mintConvexToken({ subject: "s", name: "n", email: "e" }),
    ).rejects.toThrow(/CONVEX_TOKEN_PRIVATE_KEY/);
    process.env.CONVEX_TOKEN_PRIVATE_KEY = saved;
  });
});
