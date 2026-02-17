import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import pool from "@/lib/db";
import { PLAN_FREE, PLAN_PRO } from "@/lib/plans";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 },
    );
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = session.customer as string;
      await pool.query("UPDATE users SET plan = $1 WHERE stripe_customer_id = $2", [
        PLAN_PRO,
        customerId,
      ]);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;
      await pool.query("UPDATE users SET plan = $1 WHERE stripe_customer_id = $2", [
        PLAN_FREE,
        customerId,
      ]);
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;
      const plan = sub.status === "active" ? PLAN_PRO : PLAN_FREE;
      await pool.query("UPDATE users SET plan = $1 WHERE stripe_customer_id = $2", [
        plan,
        customerId,
      ]);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
