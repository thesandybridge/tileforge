import { NextResponse } from "next/server";
import Stripe from "stripe";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { API_URL } from "@/lib/api";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST() {
  const session = await auth();
  if (!session?.user?.id || !session.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cancel active Stripe subscriptions if any
  const userRow = await pool.query(
    "SELECT stripe_customer_id FROM users WHERE id = $1",
    [session.user.id],
  );

  const customerId = userRow.rows[0]?.stripe_customer_id as string | null;
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
    headers: { Authorization: `Bearer ${session.accessToken}` },
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
