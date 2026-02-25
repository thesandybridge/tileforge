import NextAuth from "next-auth";
import { SignJWT } from "jose";
import pool from "@/lib/db";
import authConfig from "@/auth.config";
import { PLAN_FREE } from "@/lib/plans";

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

        // 2. No existing link — try auto-link by email
        if (!row && email) {
          const emailResult = await pool.query(
            "SELECT id, plan, deactivated_at FROM users WHERE email = $1",
            [email],
          );
          row = emailResult.rows[0];

          if (row) {
            await pool.query(
              `INSERT INTO accounts (user_id, provider, provider_account_id, username, avatar_url, email)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [row.id, provider, providerAccountId, username, avatarUrl, email],
            );
          }
        }

        // 3. Still no match — create new user + account link
        if (!row) {
          const userResult = await pool.query(
            `INSERT INTO users (username, avatar_url, email)
             VALUES ($1, $2, $3)
             RETURNING id, plan, deactivated_at`,
            [username, avatarUrl, email],
          );
          row = userResult.rows[0];

          await pool.query(
            `INSERT INTO accounts (user_id, provider, provider_account_id, username, avatar_url, email)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [row!.id, provider, providerAccountId, username, avatarUrl, email],
          );
        }

        // Reactivate if within 30-day window — reset to free plan
        if (row!.deactivated_at) {
          await pool.query(
            "UPDATE users SET deactivated_at = NULL, plan = 'free' WHERE id = $1",
            [row!.id],
          );
          row!.plan = "free";
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
