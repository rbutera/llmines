// Shared Test_Mode helpers for the host layer (Req 16.1, 20).
//
// `NEXT_PUBLIC_TEST_MODE` is inlined by Next at build time for client code, so
// reading it from `process.env` directly is safe here. When the flag is unset
// the game runs normally and every `data-testid` hook is absent from the DOM
// (Req 16.1); when it equals "1" the deterministic test hooks are emitted.

/** True only when the harness flag `NEXT_PUBLIC_TEST_MODE=1` is set. */
export const TEST_MODE: boolean = process.env.NEXT_PUBLIC_TEST_MODE === "1";

/**
 * Returns `{ "data-testid": name }` in Test_Mode and `{}` otherwise, so the
 * attribute can be spread onto an element and is completely absent in a normal
 * build (Req 20.1–20.5). Usage: `<button {...tid("start-button")}>`.
 */
export function tid(name: string): Record<string, string> {
  return TEST_MODE ? { "data-testid": name } : {};
}
