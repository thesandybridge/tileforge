import { NextResponse } from "next/server";
import { requireAuth, getStripeCustomerId, getOrigin } from "@/lib/api-utils";
import { getStripe } from "@/lib/stripe";

/**
 * POST /api/stripe/portal
 * Creates a Stripe Billing Portal session for subscription management.
 * Requires authentication and an existing Stripe customer.
 *
 * @returns { url: string } - Billing portal URL
 */
export async function POST() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const customerId = await getStripeCustomerId(userId);
  if (!customerId) {
    return NextResponse.json({ error: "No subscription found" }, { status: 400 });
  }

  const portalSession = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${getOrigin()}/billing`,
  });

  return NextResponse.json({ url: portalSession.url });
}
