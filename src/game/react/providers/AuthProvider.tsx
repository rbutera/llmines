"use client";

import {
  SessionProvider,
  signIn as nextSignIn,
  signOut as nextSignOut,
  useSession,
} from "next-auth/react";
import { createContext, useContext, useEffect, useState } from "react";
import { mockAuth, type MockIdentity } from "~/game/react/auth/mockAuth";
import { TEST_MODE } from "~/game/test-api/flag";

/**
 * Auth seam. UI consumes `useAuth()` only — never NextAuth directly — so the
 * same components run against the deterministic mock (TEST_MODE / eval) and real
 * NextAuth (normal mode). `subject` mirrors the server-derived identity id.
 */
export interface AuthValue {
  status: "authenticated" | "unauthenticated";
  name?: string;
  avatar?: string;
  subject?: string;
  signIn: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within an AuthProvider");
  return value;
}

// Default identity for a manual sign-in click in TEST_MODE (tests drive auth via
// window.__lumines.auth.signIn with explicit identities instead).
const DEV_IDENTITY: MockIdentity = { name: "Player One", subject: "dev-player" };

function MockAuthProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<MockIdentity | null>(() => mockAuth.get());
  useEffect(() => {
    const sync = () => setIdentity(mockAuth.get());
    sync();
    return mockAuth.subscribe(sync);
  }, []);

  const value: AuthValue = identity
    ? {
        status: "authenticated",
        name: identity.name,
        avatar: identity.avatar,
        subject: identity.subject,
        signIn: () => mockAuth.signIn(DEV_IDENTITY),
        signOut: () => mockAuth.signOut(),
      }
    : {
        status: "unauthenticated",
        signIn: () => mockAuth.signIn(DEV_IDENTITY),
        signOut: () => mockAuth.signOut(),
      };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function RealAuthBridge({ children }: { children: React.ReactNode }) {
  const { data } = useSession();
  const user = data?.user;
  const value: AuthValue = user
    ? {
        status: "authenticated",
        name: user.name ?? undefined,
        avatar: user.image ?? undefined,
        subject: (user as { id?: string }).id,
        signIn: () => void nextSignIn("google"),
        signOut: () => void nextSignOut(),
      }
    : {
        status: "unauthenticated",
        signIn: () => void nextSignIn("google"),
        signOut: () => void nextSignOut(),
      };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function RealAuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <RealAuthBridge>{children}</RealAuthBridge>
    </SessionProvider>
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (TEST_MODE) return <MockAuthProvider>{children}</MockAuthProvider>;
  return <RealAuthProvider>{children}</RealAuthProvider>;
}
