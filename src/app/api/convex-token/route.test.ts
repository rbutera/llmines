import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the auth() session source and the signer so the route is tested in
// isolation (no real key, no NextAuth runtime).
const authMock = vi.fn();
vi.mock("../../../server/auth", () => ({ auth: authMock }));
vi.mock("../../../server/convex-token", () => ({
  mintConvexToken: vi.fn(async () => "signed.jwt.token"),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("POST /api/convex-token", () => {
  it("returns 401 with no-store when signed out", async () => {
    authMock.mockResolvedValueOnce(null);
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 401 when a session exists but carries no subject (user.id)", async () => {
    authMock.mockResolvedValueOnce({ user: { name: "x", email: "x@y.z" } });
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("mints a token from the SESSION subject only (never a request param)", async () => {
    authMock.mockResolvedValueOnce({
      user: { id: "g|sub", name: "Mark", email: "mark@example.com" },
    });
    const { mintConvexToken } = await import("../../../server/convex-token");
    const { POST } = await import("./route");
    const res = await POST();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { token: string };
    expect(body.token).toBe("signed.jwt.token");
    expect(mintConvexToken).toHaveBeenCalledWith({
      subject: "g|sub",
      name: "Mark",
      email: "mark@example.com",
    });
  });

  it("falls back to safe name/email defaults when the profile omits them", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "g|min" } });
    const { mintConvexToken } = await import("../../../server/convex-token");
    const { POST } = await import("./route");
    await POST();
    expect(mintConvexToken).toHaveBeenCalledWith({
      subject: "g|min",
      name: "Player",
      email: "",
    });
  });
});
