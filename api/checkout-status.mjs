import Stripe from "stripe";
import { json, methodAllowed, safeError } from "../server/shop/http.mjs";
import { getOrderBySession } from "../server/shop/supabase.mjs";

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["GET"])) return;
  if (!stripe) return json(res, 503, { error: "Stripe is not configured." });
  const sessionId = typeof req.query?.session_id === "string" ? req.query.session_id : "";
  if (!/^cs_(test|live)_/.test(sessionId)) return json(res, 400, { error: "Invalid checkout session." });
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const order = await getOrderBySession(sessionId);
    json(res, 200, {
      checkoutStatus: session.status,
      paymentStatus: session.payment_status,
      customerEmail: session.customer_details?.email ?? session.customer_email ?? null,
      amountTotal: session.amount_total,
      currency: session.currency,
      order: order ? {
        id: order.id,
        status: order.status,
        submitAfter: order.submit_after,
        items: order.order_items?.map((item) => ({ title: item.title, size: item.size })) ?? [],
      } : null,
    });
  } catch (error) {
    console.error("checkout status:", safeError(error));
    json(res, 404, { error: "Checkout session was not found." });
  }
}
