import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

/**
 * Requires authentication for an API route.
 * Returns the session if authenticated, or a 401 response if not.
 *
 * @example
 * const result = await requireAuth();
 * if (result instanceof NextResponse) return result;
 * const { session, userId } = result;
 */
export async function requireAuth(opts?: { requireToken?: boolean }) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (opts?.requireToken && !session.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return {
    session,
    userId: session.user.id,
    accessToken: session.accessToken,
  };
}

/**
 * Gets the Stripe customer ID for a user.
 * Returns null if the user doesn't have one.
 */
export async function getStripeCustomerId(userId: string): Promise<string | null> {
  const result = await pool.query(
    "SELECT stripe_customer_id FROM users WHERE id = $1",
    [userId],
  );
  return result.rows[0]?.stripe_customer_id ?? null;
}

/**
 * Gets the app origin URL for redirects.
 */
export function getOrigin(): string {
  return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}
