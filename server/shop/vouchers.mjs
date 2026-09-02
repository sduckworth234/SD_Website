// Gift vouchers.
//
// A voucher is nothing more than a Stripe coupon (amount_off, once) plus a
// single-use promotion code. Redemption therefore needs no new code path at
// all: the buyer's recipient types the code into the promotion field the
// checkout already has.
//
// Everything here must survive being called twice — Stripe retries webhooks.
// Two mechanisms make that safe:
//   * the code is DERIVED from the session id, so a retry produces the same
//     code rather than a second voucher;
//   * every Stripe write carries an idempotency key built from the session id,
//     so a retry returns the original object instead of creating a new one.
import { createHmac } from "node:crypto";
import { sendGiftVoucher } from "./email.mjs";
import { supabaseRest } from "./supabase.mjs";

export const VOUCHER_AMOUNTS_CENTS = [10000, 20000, 40000];
export const VOUCHER_KIND = "gift_voucher";

function cleanField(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Builds the gift-voucher Checkout Session.
 *
 * Deliberately a plain HOSTED session rather than the embedded Payment Element
 * the print checkout uses: there is nothing to configure, no shipping to quote
 * and no order to build, so the buyer is better served by Stripe's own page
 * than by a second bespoke payment form.
 *
 * It lives here, and is dispatched from api/create-checkout-session.mjs on the
 * `kind` field, rather than in an endpoint of its own — Vercel's Hobby plan
 * allows 12 serverless functions and every route file spends one.
 */
export async function createVoucherSession(stripe, body, origin) {
  const amountCents = Number(body.amountCents);
  if (!VOUCHER_AMOUNTS_CENTS.includes(amountCents)) throw new Error("Choose one of the listed voucher amounts.");
  const buyerEmail = cleanField(body.buyerEmail, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) throw new Error("Enter a valid email address.");
  const buyerName = cleanField(body.buyerName, 120);
  const recipientName = cleanField(body.recipientName, 120);
  if (!recipientName) throw new Error("Enter the name of the person receiving the voucher.");
  const message = cleanField(body.message, 400);

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

  return { url: session.url, sessionId: session.id };
}

export function isVoucherSession(session) {
  return session?.metadata?.kind === VOUCHER_KIND;
}

// Crockford-ish alphabet: no I, O, S or U, so a hand-typed code cannot be
// confused with 1, 0, 5 or V.
const ALPHABET = "ABCDEFGHJKLMNPQRTVWXYZ23456789";

// Deterministic but unguessable: the session id alone is not enough, the
// signing secret is required. That keeps webhook retries idempotent without
// making a code derivable by anyone who has seen a session id.
export function voucherCodeFor(sessionId) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? process.env.STRIPE_SECRET_KEY ?? "sd-voucher";
  const digest = createHmac("sha256", secret).update(`gift-voucher:${sessionId}`).digest();
  const chars = [...digest.subarray(0, 8)].map((byte) => ALPHABET[byte % ALPHABET.length]);
  return `SD-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

async function existingVoucher(sessionId) {
  try {
    const rows = await supabaseRest(
      `gift_vouchers?stripe_checkout_session_id=eq.${encodeURIComponent(sessionId)}&select=*&limit=1`,
    );
    return rows?.[0] ?? null;
  } catch (error) {
    // The table may not exist yet (migration pending). Stripe idempotency keys
    // still make the coupon/promotion-code writes safe, so continue and let
    // the buyer receive their code.
    console.error("gift voucher lookup:", error instanceof Error ? error.message : error);
    return null;
  }
}

async function recordVoucher(row) {
  try {
    const rows = await supabaseRest("gift_vouchers?on_conflict=stripe_checkout_session_id", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    });
    return rows?.[0] ?? null;
  } catch (error) {
    console.error("gift voucher record:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function fulfilVoucherSession(stripe, sessionId) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!["paid", "no_payment_required"].includes(session.payment_status)) return null;
  if (!isVoucherSession(session)) throw new Error("Checkout Session is not a gift voucher.");

  const already = await existingVoucher(sessionId);
  if (already?.emailed_at) return already;

  const amountCents = Number(session.metadata?.voucher_amount_cents ?? session.amount_total ?? 0);
  if (!Number.isInteger(amountCents) || amountCents < 1000 || amountCents > 200000) {
    throw new Error("Gift voucher session has an invalid amount.");
  }
  const code = voucherCodeFor(sessionId);
  const buyerEmail = session.customer_details?.email ?? session.customer_email;
  if (!buyerEmail) throw new Error("Gift voucher session has no buyer email.");

  const coupon = await stripe.coupons.create({
    amount_off: amountCents,
    currency: "aud",
    duration: "once",
    name: `Gift voucher ${code}`,
    metadata: { kind: VOUCHER_KIND, checkout_session: sessionId },
  }, { idempotencyKey: `voucher-coupon-${sessionId}` });

  const promotion = await stripe.promotionCodes.create({
    // Current API shape: the coupon is nested inside `promotion`.
    promotion: { type: "coupon", coupon: coupon.id },
    code,
    max_redemptions: 1,
    metadata: { kind: VOUCHER_KIND, checkout_session: sessionId },
  }, { idempotencyKey: `voucher-code-${sessionId}` });

  const voucher = {
    stripe_checkout_session_id: sessionId,
    stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
    stripe_coupon_id: coupon.id,
    stripe_promotion_code_id: promotion.id,
    code,
    amount_cents: amountCents,
    currency: "AUD",
    buyer_email: buyerEmail,
    buyer_name: session.metadata?.buyer_name || session.customer_details?.name || null,
    recipient_name: session.metadata?.recipient_name || null,
    message: session.metadata?.voucher_message || null,
    emailed_at: new Date().toISOString(),
  };
  await sendGiftVoucher(voucher);
  return (await recordVoucher(voucher)) ?? voucher;
}
