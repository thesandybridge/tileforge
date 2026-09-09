import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { resolveProviderAccount, type ProviderIdentity } from "../../lib/account-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
test.skip(!databaseUrl, "TEST_DATABASE_URL is required for PostgreSQL integration tests");

const pool = new pg.Pool({ connectionString: databaseUrl });
const identity = (provider: string, account: string, email: string): ProviderIdentity => ({
  provider,
  providerAccountId: account,
  username: `${provider}-${account}`,
  avatarUrl: `https://example.test/${provider}/${account}.png`,
  email,
  emailVerified: true,
});

test.beforeAll(async () => {
  for (const migration of ["001_initial.sql", "003_deactivation.sql", "011_multi_provider_accounts.sql"]) {
    const sql = await readFile(resolve(process.cwd(), "../crates/api/migrations", migration), "utf8");
    await pool.query(sql);
  }
});

test.beforeEach(async () => {
  await pool.query("TRUNCATE accounts, users CASCADE");
});

test.afterAll(async () => {
  await pool.end();
});

test("concurrent verified providers resolve to one user", async () => {
  const [github, google] = await Promise.all([
    resolveProviderAccount(pool, identity("github", "101", "same@example.test")),
    resolveProviderAccount(pool, identity("google", "202", "SAME@example.test")),
  ]);

  expect(github.userId).toBe(google.userId);
  const counts = await pool.query<{ users: string; accounts: string }>(
    `SELECT (SELECT count(*) FROM users)::text AS users,
            (SELECT count(*) FROM accounts)::text AS accounts`,
  );
  expect(counts.rows[0]).toEqual({ users: "1", accounts: "2" });
});

test("a provider cannot be linked to a different user", async () => {
  const owner = await resolveProviderAccount(pool, identity("github", "303", "owner@example.test"));
  const target = await resolveProviderAccount(pool, identity("google", "404", "target@example.test"));

  await expect(
    resolveProviderAccount(pool, identity("github", "303", "changed@example.test"), target.userId),
  ).rejects.toThrow("already linked to another user");

  const account = await pool.query<{ user_id: string; email: string }>(
    "SELECT user_id, email FROM accounts WHERE provider = 'github' AND provider_account_id = '303'",
  );
  expect(account.rows[0]).toEqual({ user_id: owner.userId, email: "owner@example.test" });
});

test("expired deactivated accounts stay deactivated", async () => {
  const account = await resolveProviderAccount(pool, identity("github", "505", "expired@example.test"));
  await pool.query("UPDATE users SET deactivated_at = now() - interval '31 days' WHERE id = $1", [
    account.userId,
  ]);

  await expect(
    resolveProviderAccount(pool, identity("github", "505", "expired@example.test")),
  ).rejects.toThrow("reactivation window has expired");

  const result = await pool.query<{ deactivated: boolean }>(
    "SELECT deactivated_at IS NOT NULL AS deactivated FROM users WHERE id = $1",
    [account.userId],
  );
  expect(result.rows[0].deactivated).toBe(true);
});
