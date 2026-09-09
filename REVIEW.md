# Repository review — September 2026

## Authentication changes in this working tree

- Refresh the browser session every five minutes while online, renewing the one-hour API token. This addresses long-lived active tabs; it does not prove the cause of production cookie loss. A tab waking from sleep may still need a refresh before its first API request.
- Require account-link intent to match the authenticated session, consume the intent cookie after callbacks, and reject accounts already owned by another user. Previously, an editable cookie supplied the account owner without session verification.
- Validate callback URLs by parsed origin, preventing lookalike domains from passing a string-prefix check.
- Show sign-in errors and preserve the requested destination.
- Honor configured session lifetime and accept previous signing keys during key rotation, retaining compatibility with existing HS256 cookies.
- Add isolated auth policy/token regression tests (`cd web && npm run test:auth`).

## Production GitHub sign-in diagnosis

The checkout contains no deployment environment files or production auth logs. Missing production credentials remain a hypothesis.

1. On the **web service**, verify `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` belong to the same GitHub OAuth application. These are OAuth credentials, not a personal access token.
2. Set the application's authorization callback to `https://<canonical-host>/api/auth/callback/github`. Use a separate OAuth app for localhost when needed. See [Auth.js GitHub setup](https://authjs.dev/getting-started/providers/github).
3. Keep `AUTH_SECRET` stable across deploys and identical across web replicas. Verify the canonical `AUTH_URL` and forwarded host/protocol settings. Changing the signing secret invalidates existing sessions unless old keys remain available during rotation.
4. Match `JWT_SECRET` between web and Rust API. A mismatch breaks API authorization even if OAuth succeeds.
5. Verify the web database connection and that migration `011_multi_provider_accounts.sql` has run. OAuth callbacks now query `accounts`, including for returning GitHub users.
6. Inspect server-side Auth.js errors for configuration, callback, token exchange, or database failures. Do not log cookies, tokens, or secrets.

The dependency install failed with GitHub Packages `401` for `@thesandybridge/ui`. `web/.npmrc` expects `NPM_TOKEN` with package read access. This is independent of login OAuth credentials. Full build/typecheck verification requires restoring package access.

Validation: all 10 auth policy/token tests passed in a temporary fixture using public dependencies (Playwright 1.58.2 and Auth.js 5.0.0-beta.30). `git diff --check` passed. Full application typecheck, build, browser flows, and live OAuth/database integration remain unverified.

## Prioritized follow-up work

| Priority | Finding | Recommended change |
| --- | --- | --- |
| Done | Private React Query data is scoped to the authenticated user ID and stale private cache entries are removed when identity changes. | Implemented in the query provider and private-data hooks. |
| Medium | CI runs on main pushes only; browser tests are not executed. | Add PR checks and auth regression tests; configure package access appropriately for trusted CI contexts. |
| Medium | Account auto-linking and explicit linking are intertwined in one large JWT callback. | Extract a transactional account service; test ownership conflicts, concurrent sign-ins, verified-email policy, and deactivation behavior against Postgres. |
| Low | README describes browser-only processing as universal despite optional server processing; auth and deployment documentation also drifted. | Document browser/server privacy separately and reconcile deployed behavior with setup instructions. |

## Zustand persistence

Implemented for tile defaults and saved presets in `web/lib/preferences-store.ts`. It preserves the existing `tileforge:tile-defaults` and `tileforge:presets` keys through one-time migration, persists only serializable preference fields, validates loaded values, and hydrates explicitly after mount. Cross-tab synchronization remains a possible follow-up.

Zustand's [`persist` middleware](https://zustand.docs.pmnd.rs/reference/middlewares/persist) provides the field selection, versioning/migrations, and manual hydration used here.

Keep sessions in Auth.js and server data in React Query. Do not persist bearer tokens, uploaded images, output blobs, workers, or transient processing status in localStorage. Recoverable processing jobs would need server job IDs and a separate resume design.
