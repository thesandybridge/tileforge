import type { Pool, PoolClient } from "pg";

export interface ProviderIdentity {
  provider: string;
  providerAccountId: string;
  username: string;
  avatarUrl: string;
  email: string | null;
  emailVerified: boolean;
}

export interface ResolvedAccount {
  userId: string;
  plan: string;
  username: string;
  avatarUrl: string;
}

interface UserRow {
  id: string;
  plan: string;
  deactivated_at: Date | string | null;
}

export function isWithinReactivationWindow(
  deactivatedAt: Date | string,
  now = Date.now(),
): boolean {
  const timestamp = new Date(deactivatedAt).getTime();
  return Number.isFinite(timestamp) && now >= timestamp && now - timestamp <= 30 * 86_400_000;
}

async function reactivateIfEligible(client: PoolClient, row: UserRow): Promise<UserRow> {
  if (!row.deactivated_at) return row;
  if (!isWithinReactivationWindow(row.deactivated_at)) {
    throw new Error("This account's reactivation window has expired");
  }
  await client.query(
    "UPDATE users SET deactivated_at = NULL, plan = 'free' WHERE id = $1",
    [row.id],
  );
  return { ...row, plan: "free", deactivated_at: null };
}

export async function resolveProviderAccount(
  pool: Pool,
  identity: ProviderIdentity,
  linkUserId?: string,
): Promise<ResolvedAccount> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      identity.provider,
      identity.providerAccountId,
    ]);

    const existing = await client.query<UserRow>(
      `SELECT u.id, u.plan, u.deactivated_at
       FROM accounts a JOIN users u ON u.id = a.user_id
       WHERE a.provider = $1 AND a.provider_account_id = $2
       FOR UPDATE OF a, u`,
      [identity.provider, identity.providerAccountId],
    );
    let user = existing.rows[0];

    if (user) {
      await client.query(
        `UPDATE accounts SET username = $1, avatar_url = $2, email = $3
         WHERE provider = $4 AND provider_account_id = $5`,
        [
          identity.username,
          identity.avatarUrl,
          identity.email,
          identity.provider,
          identity.providerAccountId,
        ],
      );
    }

    if (linkUserId) {
      if (user && user.id !== linkUserId) {
        throw new Error("This provider account is already linked to another user");
      }
      if (!user) {
        const target = await client.query<UserRow>(
          "SELECT id, plan, deactivated_at FROM users WHERE id = $1 FOR UPDATE",
          [linkUserId],
        );
        user = target.rows[0];
        if (!user) throw new Error("The account being linked no longer exists");
        await client.query(
          `INSERT INTO accounts (user_id, provider, provider_account_id, username, avatar_url, email)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            user.id,
            identity.provider,
            identity.providerAccountId,
            identity.username,
            identity.avatarUrl,
            identity.email,
          ],
        );
      }
      const primary = await client.query<{ username: string; avatar_url: string }>(
        "SELECT username, avatar_url FROM accounts WHERE user_id = $1 ORDER BY created_at LIMIT 1",
        [user.id],
      );
      user = await reactivateIfEligible(client, user);
      await client.query("COMMIT");
      return {
        userId: user.id,
        plan: user.plan,
        username: primary.rows[0]?.username ?? identity.username,
        avatarUrl: primary.rows[0]?.avatar_url ?? identity.avatarUrl,
      };
    }

    if (!user && identity.email && identity.emailVerified) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        identity.email.toLowerCase(),
      ]);
      const emailMatch = await client.query<UserRow>(
        "SELECT id, plan, deactivated_at FROM users WHERE lower(email) = lower($1) FOR UPDATE",
        [identity.email],
      );
      user = emailMatch.rows[0];
      if (user) {
        await client.query(
          `INSERT INTO accounts (user_id, provider, provider_account_id, username, avatar_url, email)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            user.id,
            identity.provider,
            identity.providerAccountId,
            identity.username,
            identity.avatarUrl,
            identity.email,
          ],
        );
      }
    }

    if (!user) {
      const created = await client.query<UserRow>(
        `INSERT INTO users (username, avatar_url, email) VALUES ($1, $2, $3)
         RETURNING id, plan, deactivated_at`,
        [identity.username, identity.avatarUrl, identity.email],
      );
      user = created.rows[0];
      await client.query(
        `INSERT INTO accounts (user_id, provider, provider_account_id, username, avatar_url, email)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          user.id,
          identity.provider,
          identity.providerAccountId,
          identity.username,
          identity.avatarUrl,
          identity.email,
        ],
      );
    }

    user = await reactivateIfEligible(client, user);
    await client.query("COMMIT");
    return {
      userId: user.id,
      plan: user.plan,
      username: identity.username,
      avatarUrl: identity.avatarUrl,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
