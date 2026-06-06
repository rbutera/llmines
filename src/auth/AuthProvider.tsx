"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  signIn as nextAuthSignIn,
  signOut as nextAuthSignOut,
  useSession,
} from "next-auth/react";
import { TEST_MODE } from "~/game/test-api/flag";

export interface AppUser {
  subject: string;
  name: string;
  image?: string;
  convexToken?: string;
}

export interface MockSignInArgs {
  name: string;
  subject: string;
  image?: string;
}

interface AuthContextValue {
  user: AppUser | null;
  status: "loading" | "authenticated" | "unauthenticated";
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  mockSignIn: (args: MockSignInArgs) => void;
  mockSignOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [mockUser, setMockUser] = useState<AppUser | null>(null);

  const realUser = useMemo<AppUser | null>(() => {
    if (!session?.user) return null;
    const subject = session.user.id ?? session.user.email ?? session.user.name;
    if (!subject) return null;
    return {
      subject,
      name: session.user.name ?? "Player",
      image: session.user.image ?? undefined,
      convexToken: session.convexToken,
    };
  }, [session]);

  const signIn = useCallback(async () => {
    if (TEST_MODE) return;
    await nextAuthSignIn("google");
  }, []);

  const signOut = useCallback(async () => {
    if (TEST_MODE) {
      setMockUser(null);
      return;
    }
    await nextAuthSignOut();
  }, []);

  const mockSignIn = useCallback((args: MockSignInArgs) => {
    if (!TEST_MODE) return;
    setMockUser({
      subject: args.subject,
      name: args.name,
      image: args.image,
      convexToken: `mock-token:${args.subject}`,
    });
  }, []);

  const mockSignOut = useCallback(() => {
    if (!TEST_MODE) return;
    setMockUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: TEST_MODE ? mockUser : realUser,
      status: TEST_MODE
        ? mockUser
          ? "authenticated"
          : "unauthenticated"
        : status,
      signIn,
      signOut,
      mockSignIn,
      mockSignOut,
    }),
    [mockSignIn, mockSignOut, mockUser, realUser, signIn, signOut, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (value === null)
    throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
