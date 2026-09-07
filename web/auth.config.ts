import GitHub from "next-auth/providers/github";
import Discord from "next-auth/providers/discord";
import Google from "next-auth/providers/google";
import { SignJWT, jwtVerify } from "jose";
import type { NextAuthConfig } from "next-auth";

/**
 * Auth.js config that is safe for the Edge runtime (no Node.js-only imports).
 * Used by middleware. The full auth.ts extends this with DB callbacks.
 */
const useSecureCookies = process.env.NODE_ENV === "production";

export default {
  providers: [GitHub, Discord, Google],
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  cookies: {
    sessionToken: {
      name: "tileforge.session-token",
      options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: useSecureCookies },
    },
    callbackUrl: {
      name: "tileforge.callback-url",
      options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: useSecureCookies },
    },
    csrfToken: {
      name: "tileforge.csrf-token",
      options: { httpOnly: false, sameSite: "lax" as const, path: "/", secure: useSecureCookies },
    },
  },
  jwt: {
    async encode({ token, secret, maxAge = 30 * 24 * 60 * 60 }) {
      if (!token) return "";
      const secretKey =
        typeof secret === "string"
          ? new TextEncoder().encode(secret)
          : new TextEncoder().encode(secret[0]);
      return new SignJWT(token as Record<string, unknown>)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + maxAge)
        .sign(secretKey);
    },
    async decode({ token, secret }) {
      if (!token) return null;
      // Sign with the current key, but accept previous keys during rotation.
      for (const candidate of typeof secret === "string" ? [secret] : secret) {
        try {
          const { payload } = await jwtVerify(token, new TextEncoder().encode(candidate), {
            algorithms: ["HS256"],
          });
          return payload;
        } catch {
          // Try the next configured key.
        }
      }
      return null;
    },
  },
} satisfies NextAuthConfig;
