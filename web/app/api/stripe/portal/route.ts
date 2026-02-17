import { NextResponse } from "next/server";
import Stripe from "stripe";
import { auth } from "@/auth";
import pool from "@/lib/db";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userRow = await pool.query(
    "SELECT stripe_customer_id FROM users WHERE id = $1",
    [session.user.id],
  );

  const customerId = userRow.rows[0]?.stripe_customer_id as string | null;
  if (!customerId) {
    return NextResponse.json({ error: "No subscription found" }, { status: 400 });
  }

  const origin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/billing`,
  });

  return NextResponse.json({ url: portalSession.url });
}
