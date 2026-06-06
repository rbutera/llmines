/**
 * Deterministic in-memory auth state for TEST_MODE (eval). Driven by
 * `window.__lumines.auth.signIn/signOut` (and the sign-in button in test mode).
 * The `subject` is the server-derived identity id the scores backend keys on.
 * Never used in a normal build.
 */

export interface MockIdentity {
  name: string;
  subject: string;
  avatar?: string;
}

let current: MockIdentity | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const mockAuth = {
  get(): MockIdentity | null {
    return current;
  },
  signIn(identity: MockIdentity): void {
    current = identity;
    emit();
  },
  signOut(): void {
    current = null;
    emit();
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
