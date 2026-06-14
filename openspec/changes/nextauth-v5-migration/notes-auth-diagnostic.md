# Wave 0 auth diagnostic — run live 2026-06-13 ~02:30 BST (orchestrator)

Results against https://llmines.e8n.dev (deployed Worker):

## Findings

1. **Defect 1 (provider not registered) — RULED OUT.** `GET /api/auth/providers` returns the
   Google provider with the CORRECT origin-derived URLs:
   `{"google":{"signinUrl":"https://llmines.e8n.dev/api/auth/signin/google",
   "callbackUrl":"https://llmines.e8n.dev/api/auth/callback/google"}}`.
   So `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` ARE set in the Worker, and host/origin derivation is
   working (the design's defect 2 host-derivation half is also effectively ruled out — the
   callback URL is right).

2. **The ACTUAL failure: `OAuthSignin` while constructing the authorization URL.**
   `POST /api/auth/signin/google` (with a valid CSRF token + cookie, `json=true`) returns
   `{"url":"https://llmines.e8n.dev/api/auth/error?error=OAuthSignin"}` — NextAuth v4 throws
   SERVER-SIDE before ever redirecting to Google. This is a defect NOT in the design's original
   set:

   **NextAuth v4 (4.24.14) uses openid-client, which performs Google issuer discovery + token
   exchange over Node's `http`/`https` modules. The Worker runs `compatibility_date: 2025-05-05`
   with `nodejs_compat` (wrangler.jsonc) — Node http CLIENT support on Workers requires a later
   compatibility date (Cloudflare shipped outbound node:http client support to `nodejs_compat`
   for compat dates ≥ ~2025-08-15). So the discovery fetch fails at runtime → getAuthorizationUrl
   throws → `OAuthSignin`.**

3. **Defect 3 (Convex issuer) — UNVERIFIED** (cannot complete a sign-in until 2 is fixed).
   `convex/auth.config.ts` still defaults to `https://example.com` if `CONVEX_AUTH_ISSUER_DOMAIN`
   is unset on the Convex deployment; verify AFTER sign-in works (real sign-in → does
   `submitScore` resolve an authenticated identity).

## Fix order for the implementer

1. **Try the cheap fix first: bump `compatibility_date` in wrangler.jsonc to ≥ 2025-09-01**
   (keeps `nodejs_compat`; this enables the Node http client used by openid-client). Redeploy,
   re-run the probe (`POST /api/auth/signin/google` with csrf, expect a `accounts.google.com`
   authorize URL back instead of the OAuthSignin error). Watch for regressions from the compat
   bump in the production-start e2e + repro-autoplay gates.
2. **If the compat bump doesn't fix it: migrate to next-auth v5 / @auth/core** (fetch-based,
   edge-native). Client surface (`next-auth/react` signIn/signOut/useSession) is compatible;
   server surface changes (authOptions → NextAuth() config, getServerSession → auth()).
3. After the authorize URL is returned: complete a REAL sign-in in a browser. If Google rejects
   with `redirect_uri_mismatch`, the Google console needs
   `https://llmines.e8n.dev/api/auth/callback/google` registered — EXTERNAL step, flag for Rai
   (do not block the rest of the change on it).
4. Then verify defect 3: signed-in `submitScore` resolves an identity; if not, set
   `CONVEX_AUTH_ISSUER_DOMAIN` on the Convex deployment (npx convex env) to
   `https://llmines.e8n.dev`.

`trustHost`/`NEXTAUTH_URL` plumbing from the design's defect 2 appears unnecessary (origin
derivation demonstrably works) — do not add dead config.

## Probe commands (re-usable)

```bash
curl -s https://llmines.e8n.dev/api/auth/providers
CSRF=$(curl -s -c /tmp/c.txt https://llmines.e8n.dev/api/auth/csrf | jq -r .csrfToken)
curl -s -b /tmp/c.txt -X POST https://llmines.e8n.dev/api/auth/signin/google \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "csrfToken=$CSRF&callbackUrl=https://llmines.e8n.dev&json=true"
# success = {"url":"https://accounts.google.com/o/oauth2/v2/auth?..."}
# failure = {"url":"https://llmines.e8n.dev/api/auth/error?error=OAuthSignin"}
```
