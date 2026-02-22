import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAuth, getStripeCustomerId, getOrigin } from "@/lib/api-utils";
import { getStripe } from "@/lib/stripe";

/**
 * POST /api/stripe/checkout
 * Creates a Stripe Checkout session for Pro subscription.
 * Requires authentication.
 *
 * @returns { url: string } - Checkout session URL
 */
export async function POST() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { session, userId } = authResult;

  // Look up or create Stripe customer
  let customerId = await getStripeCustomerId(userId);

  if (!customerId) {
    const customer = await getStripe().customers.create({
      metadata: { user_id: userId },
      email: session.user.email ?? undefined,
      name: session.user.username ?? undefined,
    });
    customerId = customer.id;
    await pool.query(
      "UPDATE users SET stripe_customer_id = $1 WHERE id = $2",
      [customerId, userId],
    );
  }

  const checkoutSession = await getStripe().checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID!, quantity: 1 }],
    success_url: `${getOrigin()}/billing?upgraded=true`,
    cancel_url: `${getOrigin()}/billing`,
    subscription_data: {
      metadata: { user_id: userId },
    },
  });

  if (!checkoutSession.url) {
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: checkoutSession.url });
}
