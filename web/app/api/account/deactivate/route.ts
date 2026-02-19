import { NextResponse } from "next/server";
import Stripe from "stripe";
import { API_URL } from "@/lib/api";
import { requireAuth, getStripeCustomerId } from "@/lib/api-utils";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/**
 * POST /api/account/deactivate
 * Deactivates the user's account:
 * - Cancels all active Stripe subscriptions
 * - Marks user as deactivated in backend (30-day deletion window)
 * Requires authentication with access token.
 *
 * @returns { deactivated: boolean }
 */
export async function POST() {
  const authResult = await requireAuth({ requireToken: true });
  if (authResult instanceof NextResponse) return authResult;
  const { userId, accessToken } = authResult;

  // Cancel active Stripe subscriptions if any
  const customerId = await getStripeCustomerId(userId);
  if (customerId) {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
    });
    for (const sub of subscriptions.data) {
      await stripe.subscriptions.cancel(sub.id);
    }
  }

  // Call Rust API to deactivate user
  const res = await fetch(`${API_URL}/api/user/deactivate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    return NextResponse.json(
      { error: body.error ?? "Deactivation failed" },
      { status: res.status },
    );
  }

  return NextResponse.json({ deactivated: true });
}
