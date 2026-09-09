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

`web/.npmrc` expects `NPM_TOKEN` with GitHub Packages read access for `@thesandybridge/ui`. This token is independent of the GitHub OAuth credentials used for sign-in.

Validation runs the production web build, isolated auth policy/token tests, and account-resolution integration tests against PostgreSQL 17 in CI. Live OAuth remains dependent on the deployed provider configuration.

## Prioritized follow-up work

Production and development dependencies were audited on September 9, 2026.
Next.js, Auth.js, fflate, PostCSS, Rust TLS/QUIC dependencies, and affected
transitive packages were upgraded. Both dependency ecosystems are audited in CI;
`npm audit` reports zero known vulnerabilities.

| Priority | Finding | Recommended change |
| --- | --- | --- |
| Done | Private React Query data is scoped to the authenticated user ID and stale private cache entries are removed when identity changes. | Implemented in the query provider and private-data hooks. |
| Done | CI runs for pushes and pull requests, cancels superseded runs, and executes the isolated auth regression suite after the web build. | Forked pull requests still require a package-install strategy that does not expose the private `NPM_TOKEN`. |
| Done | Account resolution runs in a dedicated transaction with advisory locks for provider identities and verified emails. PostgreSQL integration tests cover concurrent verified-email linking, ownership conflicts, rollback, and expired reactivation. | Keep these tests aligned with account schema and linking policy changes. |
| Done | README now distinguishes Local and Server mode privacy and reflects current CLI, API, CI, and WASM deployment behavior. | Keep command and endpoint examples synchronized as features change. |

## Zustand persistence

Implemented for tile defaults and saved presets in `web/lib/preferences-store.ts`. It preserves the existing `tileforge:tile-defaults` and `tileforge:presets` keys through one-time migration, persists only serializable preference fields, validates loaded values, and hydrates explicitly after mount. Cross-tab synchronization remains a possible follow-up.

Zustand's [`persist` middleware](https://zustand.docs.pmnd.rs/reference/middlewares/persist) provides the field selection, versioning/migrations, and manual hydration used here.

Keep sessions in Auth.js and server data in React Query. Do not persist bearer tokens, uploaded images, output blobs, workers, or transient processing status in localStorage. Recoverable processing jobs would need server job IDs and a separate resume design.
