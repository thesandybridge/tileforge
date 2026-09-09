import NextAuth from "next-auth";
import { SignJWT } from "jose";
import { linkStore } from "@/lib/link-store";
import pool from "@/lib/db";
import authConfig from "@/auth.config";
import { PLAN_FREE } from "@/lib/plans";
import { safeRedirect } from "@/lib/auth-policy";
import { resolveProviderAccount } from "@/lib/account-service";

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
      return safeRedirect(url, baseUrl);
    },
    async jwt({ token, trigger, account, profile }) {
      // Re-read plan + avatar from DB when session.update() is called
      if (trigger === "update" && token.userId) {
        const result = await pool.query(
          "SELECT plan, avatar_url FROM users WHERE id = $1",
          [token.userId],
        );
        if (result.rows[0]) {
          token.plan = result.rows[0].plan;
          token.avatarUrl = result.rows[0].avatar_url;
        }
      }

      if (trigger === "signIn" && account && profile) {
        try {
          const provider = account.provider;
          const { providerAccountId, username, avatarUrl, email } =
            extractProfile(provider, profile as Profile);
          if (!providerAccountId || providerAccountId === "undefined") {
            throw new Error(`Missing account identifier for ${provider}`);
          }

          const linkUserId = linkStore.getStore();
          const resolved = await resolveProviderAccount(
            pool,
            {
              provider,
              providerAccountId,
              username,
              avatarUrl,
              email,
              emailVerified:
                provider === "github" ||
                (profile as Record<string, unknown>).email_verified === true,
            },
            linkUserId,
          );
          token.userId = resolved.userId;
          token.plan = resolved.plan;
          token.username = resolved.username;
          token.avatarUrl = resolved.avatarUrl;
          token.sub = resolved.userId;
        } catch (err) {
          console.error("[auth] jwt callback error:", err);
          throw err;
        }
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
