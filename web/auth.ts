import NextAuth from "next-auth";
import { SignJWT } from "jose";
import pool from "@/lib/db";
import authConfig from "@/auth.config";
import { PLAN_FREE } from "@/lib/plans";

const jwtSecret = new TextEncoder().encode(process.env.JWT_SECRET);

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

      if (trigger === "signIn" && account?.provider === "github" && profile) {
        const githubId = Number(profile.id);
        const username = (profile.login as string) ?? profile.name ?? "";
        const avatarUrl = (profile.avatar_url as string) ?? profile.image ?? "";
        const email = profile.email ?? null;

        // Upsert user in Postgres
        const result = await pool.query(
          `INSERT INTO users (github_id, username, avatar_url, email)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (github_id) DO UPDATE
             SET username = EXCLUDED.username,
                 avatar_url = EXCLUDED.avatar_url,
                 email = EXCLUDED.email,
                 updated_at = now()
           RETURNING id, plan, deactivated_at`,
          [githubId, username, avatarUrl, email],
        );

        const row = result.rows[0];

        // Reactivate if within 30-day window — reset to free plan
        if (row.deactivated_at) {
          await pool.query(
            "UPDATE users SET deactivated_at = NULL, plan = 'free' WHERE id = $1",
            [row.id],
          );
          row.plan = "free";
        }

        token.userId = row.id;
        token.plan = row.plan;
        token.username = username;
        token.avatarUrl = avatarUrl;
        token.sub = row.id;
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
