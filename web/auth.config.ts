import GitHub from "next-auth/providers/github";
import Discord from "next-auth/providers/discord";
import Google from "next-auth/providers/google";
import { SignJWT, jwtVerify } from "jose";
import type { NextAuthConfig } from "next-auth";

/**
 * Auth.js config that is safe for the Edge runtime (no Node.js-only imports).
 * Used by middleware. The full auth.ts extends this with DB callbacks.
 */
export default {
  providers: [GitHub, Discord, Google],
  trustHost: true,
  session: { strategy: "jwt" },
  jwt: {
    async encode({ token, salt, secret }) {
      if (!token) return "";
      const secretKey =
        typeof secret === "string"
          ? new TextEncoder().encode(secret)
          : new TextEncoder().encode(secret[0]);
      return new SignJWT(token as Record<string, unknown>)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("30d")
        .sign(secretKey);
    },
    async decode({ token, salt, secret }) {
      if (!token) return null;
      try {
        const secretKey =
          typeof secret === "string"
            ? new TextEncoder().encode(secret)
            : new TextEncoder().encode(secret[0]);
        const { payload } = await jwtVerify(token, secretKey, {
          algorithms: ["HS256"],
        });
        return payload as any;
      } catch {
        return null;
      }
    },
  },
} satisfies NextAuthConfig;
