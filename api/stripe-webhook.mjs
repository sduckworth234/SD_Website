import Stripe from "stripe";
import { sendNewOrderAlert, sendOrderConfirmation } from "../server/shop/email.mjs";
import { safeError } from "../server/shop/http.mjs";
import { getOrderBySession, insertPaidOrder, supabaseRest } from "../server/shop/supabase.mjs";

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

async function reusableMaster(photoId) {
  const rows = await supabaseRest(
    `order_items?photo_id=eq.${encodeURIComponent(photoId)}&print_master_path=not.is.null&select=print_master_path,print_master_width,print_master_height&order=created_at.desc&limit=1`,
  );
  return rows?.[0] ?? null;
}

async function fulfilSession(sessionId) {
  const existing = await getOrderBySession(sessionId);
  if (existing) return existing;

  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge", "discounts", "invoice"] });
  if (!(["paid", "no_payment_required"].includes(session.payment_status))) return null;
  const count = Number(session.metadata?.cart_count ?? 0);
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("Checkout Session has invalid cart metadata.");
  const intent = typeof session.payment_intent === "string"
    ? await stripe.paymentIntents.retrieve(session.payment_intent)
    : session.payment_intent;
  const charge = typeof intent?.latest_charge === "string"
    ? await stripe.charges.retrieve(intent.latest_charge)
    : intent?.latest_charge;
  const invoice = typeof session.invoice === "string"
    ? await stripe.invoices.retrieve(session.invoice)
    : session.invoice;
  // Current Checkout Sessions expose addresses collected by the Shipping
  // Address Element under collected_information. Keep the PaymentIntent
  // fallback for orders created by the previous native-address checkout.
  const shipping = session.collected_information?.shipping_details
    ?? session.shipping_details
    ?? intent?.shipping;
  if (!shipping?.name || !shipping.address?.line1 || shipping.address.country !== "AU") {
    throw new Error("Paid Checkout Session has no valid Australian shipping address.");
  }

  const items = [];
  for (let index = 0; index < count; index += 1) {
    const raw = session.metadata?.[`item_${index}`];
    if (!raw) throw new Error(`Checkout Session is missing item_${index}.`);
    const item = JSON.parse(raw);
    const master = await reusableMaster(item.photoId);
    items.push({
      photo_id: item.photoId,
      title: item.title,
      location: item.location,
      thumb_url: session.metadata?.[`thumb_${index}`] || "",
      size: item.size,
      mounted: item.mounted,
      colour: item.colour,
      sku: item.sku,
      unit_price_cents: item.unitPriceCents,
      print_master_path: master?.print_master_path ?? null,
      print_master_width: master?.print_master_width ?? null,
      print_master_height: master?.print_master_height ?? null,
    });
  }
  const missingMaster = items.some((item) => !item.print_master_path);
  const attachedPromotion = session.discounts?.find((discount) => discount.promotion_code)?.promotion_code;
  const promotionCode = typeof attachedPromotion === "string"
    ? (await stripe.promotionCodes.retrieve(attachedPromotion)).code
    : attachedPromotion?.code;
  const shippingAddress = {
    line1: shipping.address.line1,
    line2: shipping.address.line2 ?? "",
    suburb: shipping.address.city,
    state: shipping.address.state,
    postcode: shipping.address.postal_code,
    country: shipping.address.country,
    phone: session.customer_details?.phone ?? intent?.shipping?.phone ?? session.metadata?.customer_phone ?? "",
  };
  const order = await insertPaidOrder({
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: intent?.id ?? null,
    status: missingMaster ? "awaiting_master" : "paid",
    customer_email: session.customer_details?.email ?? session.customer_email,
    customer_name: shipping.name,
    shipping_address: shippingAddress,
    currency: "AUD",
    subtotal_cents: session.amount_subtotal ?? 0,
    shipping_cents: session.shipping_cost?.amount_total ?? 0,
    discount_cents: session.total_details?.amount_discount ?? 0,
    discount_code: promotionCode || session.metadata?.promotion_code || null,
    total_cents: session.amount_total ?? 0,
    fulfilment_provider: session.metadata?.fulfilment_provider === "prodigi" ? "prodigi" : "manual",
    stripe_receipt_url: charge?.receipt_url ?? null,
    stripe_invoice_id: invoice?.id ?? null,
    stripe_invoice_url: invoice?.hosted_invoice_url ?? null,
    stripe_invoice_pdf: invoice?.invoice_pdf ?? null,
  }, items);
  // Await delivery attempts so serverless execution cannot be frozen before
  // Resend receives them. Email failure never changes the paid order record.
  const deliveries = await Promise.allSettled([
    sendOrderConfirmation(order, items),
    sendNewOrderAlert(order, items),
  ]);
  for (const delivery of deliveries) {
    if (delivery.status === "rejected") console.error("order email:", safeError(delivery.reason));
  }
  return order;
}

// Web-standard handler deliberately avoids Vercel's legacy request.body
// helper, which parses JSON. Stripe signatures must be checked against the
// exact raw bytes, including their original whitespace.
export default {
  async fetch(request) {
    if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return Response.json({ error: "Stripe webhook is not configured." }, { status: 503 });
    try {
      const signature = request.headers.get("stripe-signature");
      if (!signature) return Response.json({ error: "missing_signature" }, { status: 400 });
      const event = stripe.webhooks.constructEvent(await request.text(), signature, process.env.STRIPE_WEBHOOK_SECRET);
      if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
        await fulfilSession(event.data.object.id);
      }
      return Response.json({ received: true });
    } catch (error) {
      console.error("stripe webhook:", safeError(error));
      return Response.json({ error: "webhook_rejected" }, { status: 400 });
    }
  },
};
