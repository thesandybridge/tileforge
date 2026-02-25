import NextAuth from "next-auth";
import { SignJWT } from "jose";
import { linkStore } from "@/lib/link-store";
import pool from "@/lib/db";
import authConfig from "@/auth.config";
import { PLAN_FREE } from "@/lib/plans";

export const LINK_COOKIE = "tileforge-link-user-id";

const jwtSecret = new TextEncoder().encode(process.env.JWT_SECRET);

interface Profile {
  id?: string | number;
  sub?: string;
  login?: string;
  username?: string;
  global_name?: string;
  name?: string;
  avatar_url?: string;
  avatar?: string;
  picture?: string;
  image?: string;
  email?: string | null;
}

function extractProfile(provider: string, profile: Profile) {
  switch (provider) {
    case "github":
      return {
        providerAccountId: String(profile.id),
        username: (profile.login as string) ?? profile.name ?? "",
        avatarUrl: (profile.avatar_url as string) ?? profile.image ?? "",
        email: profile.email ?? null,
      };
    case "discord":
      return {
        providerAccountId: String(profile.id),
        username: (profile.username as string) ?? (profile.global_name as string) ?? "",
        avatarUrl: profile.avatar
          ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
          : "",
        email: profile.email ?? null,
      };
    case "google":
      return {
        providerAccountId: String(profile.sub),
        username: (profile.name as string) ?? "",
        avatarUrl: (profile.picture as string) ?? "",
        email: profile.email ?? null,
      };
    default:
      return {
        providerAccountId: String(profile.id ?? profile.sub),
        username: (profile.name as string) ?? "",
        avatarUrl: (profile.picture as string) ?? (profile.image as string) ?? "",
        email: profile.email ?? null,
      };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Allow relative URLs and same-origin redirects
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (url.startsWith(baseUrl)) return url;
      return baseUrl;
    },
    async jwt({ token, trigger, account, profile }) {
      // Re-read plan from DB when session.update() is called (e.g. after billing change)
      if (trigger === "update" && token.userId) {
        const result = await pool.query(
          "SELECT plan FROM users WHERE id = $1",
          [token.userId],
        );
        if (result.rows[0]) {
          token.plan = result.rows[0].plan;
        }
      }

      if (trigger === "signIn" && account && profile) {
        const provider = account.provider;
        const { providerAccountId, username, avatarUrl, email } =
          extractProfile(provider, profile as Profile);

        let row: { id: string; plan: string; deactivated_at: string | null } | undefined;

        // 1. Check for existing account link
        const linkResult = await pool.query(
          `SELECT u.id, u.plan, u.deactivated_at
           FROM accounts a
           JOIN users u ON u.id = a.user_id
           WHERE a.provider = $1 AND a.provider_account_id = $2`,
          [provider, providerAccountId],
        );
        row = linkResult.rows[0];

        if (row) {
          // Update profile info on the existing account link
          await pool.query(
            `UPDATE accounts
             SET username = $1, avatar_url = $2, email = $3
             WHERE provider = $4 AND provider_account_id = $5`,
            [username, avatarUrl, email, provider, providerAccountId],
          );
        }

        // 1b. Link flow — cookie read by route handler, passed via AsyncLocalStorage
        const linkUserId = linkStore.getStore();

        if (!row && linkUserId) {
          await pool.query(
            `INSERT INTO accounts (user_id, provider, provider_account_id, username, avatar_url, email)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (provider, provider_account_id) DO NOTHING`,
            [linkUserId, provider, providerAccountId, username, avatarUrl, email],
          );
          // Restore the original user's session
          const userResult = await pool.query(
            "SELECT id, plan FROM users WHERE id = $1",
            [linkUserId],
          );
          const original = userResult.rows[0];
          if (original) {
            token.userId = original.id;
            token.plan = original.plan;
            token.sub = original.id;
            // Keep the original user's username/avatar
            const primaryAccount = await pool.query(
              "SELECT username, avatar_url FROM accounts WHERE user_id = $1 ORDER BY created_at LIMIT 1",
              [original.id],
            );
            if (primaryAccount.rows[0]) {
              token.username = primaryAccount.rows[0].username;
              token.avatarUrl = primaryAccount.rows[0].avatar_url;
            }
          }
          // Skip steps 2 and 3 — already linked
          // Fall through to mint API token
        }

        // 2. No existing link — try auto-link by email (only if verified)
        // GitHub always verifies emails. Google sets email_verified=true.
        // Discord does NOT verify email ownership — skip auto-link for unverified.
        if (!row && !linkUserId) {
          const emailVerified =
            provider === "github" ||
            (profile as Record<string, unknown>).email_verified === true;

          if (email && emailVerified) {
            const emailResult = await pool.query(
              "SELECT id, plan, deactivated_at FROM users WHERE email = $1",
              [email],
            );
            row = emailResult.rows[0];

            if (row) {
              await pool.query(
                `INSERT INTO accounts (user_id, provider, provider_account_id, username, avatar_url, email)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (provider, provider_account_id) DO NOTHING`,
                [row.id, provider, providerAccountId, username, avatarUrl, email],
              );
            }
          }
        }

        // 3. Still no match — create new user + account link (transactional)
        if (!row && !linkUserId) {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const userResult = await client.query(
              `INSERT INTO users (username, avatar_url, email)
               VALUES ($1, $2, $3)
               RETURNING id, plan, deactivated_at`,
              [username, avatarUrl, email],
            );
            row = userResult.rows[0];

            await client.query(
              `INSERT INTO accounts (user_id, provider, provider_account_id, username, avatar_url, email)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [row!.id, provider, providerAccountId, username, avatarUrl, email],
            );
            await client.query("COMMIT");
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          } finally {
            client.release();
          }
        }

        // Reactivate if within 30-day window — reset to free plan
        if (row!.deactivated_at) {
          const daysSince =
            (Date.now() - new Date(row!.deactivated_at).getTime()) / 86_400_000;
          if (daysSince <= 30) {
            await pool.query(
              "UPDATE users SET deactivated_at = NULL, plan = 'free' WHERE id = $1",
              [row!.id],
            );
            row!.plan = "free";
          }
        }

        token.userId = row!.id;
        token.plan = row!.plan;
        token.username = username;
        token.avatarUrl = avatarUrl;
        token.sub = row!.id;
      }

      // Mint a short-lived API token on every JWT refresh
      if (token.userId && jwtSecret.length > 0) {
        token.apiToken = await new SignJWT({
          sub: token.userId as string,
          plan: (token.plan as string) ?? PLAN_FREE,
        })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(jwtSecret);
      }

      return token;
    },
    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId as string;
        session.user.plan = (token.plan as string) ?? PLAN_FREE;
        session.user.username = (token.username as string) ?? "";
        session.user.image = (token.avatarUrl as string) ?? null;
      }
      if (token.apiToken) {
        session.accessToken = token.apiToken as string;
      }
      return session;
    },
  },
});
