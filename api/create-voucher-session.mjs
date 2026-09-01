// Gift voucher purchase. Deliberately a plain HOSTED Checkout Session rather
// than the embedded Payment Element the print checkout uses: there is nothing
// to configure, no shipping to quote and no order to build, so the buyer is
// better served by Stripe's own page than by a second bespoke payment form.
import Stripe from "stripe";
import { checkoutEnabled } from "../server/shop/features.mjs";
import { json, methodAllowed, publicOrigin, readJson, safeError } from "../server/shop/http.mjs";
import { requireAdmin, shopRuntimeConfig } from "../server/shop/supabase.mjs";
import { VOUCHER_AMOUNTS_CENTS, VOUCHER_KIND } from "../server/shop/vouchers.mjs";

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const rateBuckets = new Map();

function rateLimited(req) {
  const key = String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "unknown").split(",")[0].trim();
  const now = Date.now();
  const recent = (rateBuckets.get(key) ?? []).filter((time) => now - time < 60_000);
  recent.push(now);
  rateBuckets.set(key, recent);
  return recent.length > 10;
}

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["POST"])) return;
  try {
    const environmentEnabled = checkoutEnabled();
    const runtime = await shopRuntimeConfig();
    const admin = environmentEnabled && runtime.shopEnabled ? null : await requireAdmin(req);
    if ((!environmentEnabled || !runtime.shopEnabled) && !admin) {
      return json(res, 503, { error: "Gift vouchers are not on sale yet." });
    }
    if (rateLimited(req)) return json(res, 429, { error: "Too many attempts. Please wait a minute and try again." });
    if (!stripe) return json(res, 503, { error: "Stripe is not configured yet." });

    const body = await readJson(req);
    const amountCents = Number(body.amountCents);
    if (!VOUCHER_AMOUNTS_CENTS.includes(amountCents)) throw new Error("Choose one of the listed voucher amounts.");
    const buyerEmail = clean(body.buyerEmail, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) throw new Error("Enter a valid email address.");
    const buyerName = clean(body.buyerName, 120);
    const recipientName = clean(body.recipientName, 120);
    if (!recipientName) throw new Error("Enter the name of the person receiving the voucher.");
    const message = clean(body.message, 400);

    const origin = publicOrigin(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: buyerEmail,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "aud",
          unit_amount: amountCents,
          product_data: {
            name: "Gift voucher",
            description: "Credit towards any framed photographic print. Emailed as a single-use code.",
          },
        },
      }],
      // The webhook branches on this tag. Without it a voucher session would
      // fall into the print-order path and fail on missing cart metadata.
      metadata: {
        kind: VOUCHER_KIND,
        voucher_amount_cents: String(amountCents),
        buyer_name: buyerName,
        recipient_name: recipientName,
        voucher_message: message,
      },
      payment_intent_data: {
        receipt_email: buyerEmail,
        metadata: { shop: "gift-voucher" },
      },
      success_url: `${origin}/shop/gift-voucher?purchase=success`,
      cancel_url: `${origin}/shop/gift-voucher`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    }, {
      idempotencyKey: `voucher-${crypto.randomUUID()}`,
    });

    json(res, 200, { url: session.url, sessionId: session.id });
  } catch (error) {
    const message = safeError(error);
    const status = /Enter |Choose one/i.test(message) ? 400 : 500;
    if (status === 500) console.error("create voucher session:", message);
    json(res, status, { error: status === 500 ? "The voucher could not be started. Please try again." : message });
  }
}
