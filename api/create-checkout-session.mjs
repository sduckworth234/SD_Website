import Stripe from "stripe";
import { fetchPricing, normaliseCart } from "../server/shop/catalogue.mjs";
import { checkoutEnabled, paidInvoicesEnabled } from "../server/shop/features.mjs";
import { json, methodAllowed, publicOrigin, readJson, safeError } from "../server/shop/http.mjs";
import { sizeIsSellable } from "../server/shop/printSizing.mjs";
import { quoteShippingCents } from "../server/shop/prodigi.mjs";
import { fetchShopPhotos, requireAdmin, shopRuntimeConfig, supabaseRest } from "../server/shop/supabase.mjs";

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

function customerFrom(body) {
  const customer = {
    name: clean(body?.customer?.name, 120),
    email: clean(body?.customer?.email, 254).toLowerCase(),
    phone: clean(body?.customer?.phone, 40),
  };
  if (!customer.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new Error("Enter a valid name and email address.");
  return customer;
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["POST"])) return;

  try {
    const environmentEnabled = checkoutEnabled();
    const runtime = await shopRuntimeConfig();
    const runtimeEnabled = environmentEnabled && runtime.shopEnabled;
    // Admins can exercise the complete Stripe test flow while public checkout
    // remains closed. The bearer token is verified against Supabase Auth and
    // public.admin_users; no client-provided boolean can activate this bypass.
    const admin = environmentEnabled && runtimeEnabled ? null : await requireAdmin(req);
    if ((!environmentEnabled || !runtimeEnabled) && !admin) {
      return json(res, 503, { error: "The print shop is not accepting orders yet." });
    }
    if (rateLimited(req)) return json(res, 429, { error: "Too many checkout attempts. Please wait a minute and try again." });
    if (!stripe) return json(res, 503, { error: "Stripe test mode is not configured yet." });
    const body = await readJson(req);
    const pricing = await fetchPricing(supabaseRest);
    const cart = normaliseCart(body.cart, pricing);
    const customer = customerFrom(body);
    const photos = await fetchShopPhotos(cart.map((item) => item.photoId));
    // Reject any size that isn't sellable for this photo — sellable_sizes
    // already merges computed resolution with any admin override, so this
    // respects a manual "sell this at A1 anyway" or "don't offer A1 for
    // this one" call the same way the size picker does. The size picker
    // already hides these, this is the real enforcement in case that's ever
    // bypassed. Fail closed: no data at all (backfill gap) blocks every size.
    for (const item of cart) {
      const photo = photos.get(item.photoId);
      if (!sizeIsSellable(photo, item.size, item.mounted)) {
        throw new Error(`${photo.title} isn't available as a ${item.mounted ? "mounted " : ""}${item.size} print.`);
      }
    }
    const provider = runtime.fulfilmentProvider;
    // Manual mode makes no Prodigi request even if a stale API key remains in
    // the deployment. Checkout stays live using the verified catalogue rate.
    const shipping = await quoteShippingCents(cart, { useProdigi: provider === "prodigi" });
    const promoText = clean(body.promotionCode, 64).toUpperCase();
    let promotion = null;
    if (promoText) {
      const result = await stripe.promotionCodes.list({ code: promoText, active: true, limit: 1 });
      promotion = result.data[0] ?? null;
      if (!promotion) throw new Error("That promotion code is not valid.");
    }
    // Stripe coupons discount line-item subtotal, not Checkout's shipping
    // option. A deliberately tagged promotion can additionally waive delivery;
    // ordinary customer promotions remain subtotal-only. The flag lives on the
    // Stripe promotion object, so a customer cannot inject it in the request.
    const freeShippingPromotion = promotion?.metadata?.free_shipping === "true";
    const chargedShippingCents = freeShippingPromotion ? 0 : shipping.cents;

    const lineItems = cart.map((item) => {
      const photo = photos.get(item.photoId);
      return {
        quantity: 1,
        price_data: {
          currency: "aud",
          unit_amount: item.unitPriceCents,
          product_data: {
            name: photo.title,
            description: `${item.size} · ${item.colour} frame · ${item.mounted ? "mounted" : "unmounted"}`,
            images: photo.thumbUrl?.startsWith("https://") ? [photo.thumbUrl] : undefined,
          },
        },
      };
    });

    const metadata = {
      cart_count: String(cart.length),
      quote_source: freeShippingPromotion ? `${shipping.source}+promotion-free-shipping` : shipping.source,
      promotion_code: promoText,
      fulfilment_provider: provider,
      customer_name: customer.name,
      customer_phone: customer.phone,
    };
    cart.forEach((item, index) => {
      const photo = photos.get(item.photoId);
      metadata[`item_${index}`] = JSON.stringify({
        ...item,
        title: photo.title,
        location: photo.location,
      });
      metadata[`thumb_${index}`] = String(photo.thumbUrl ?? "").slice(0, 500);
    });

    const session = await stripe.checkout.sessions.create({
      ui_mode: "elements",
      mode: "payment",
      customer_email: customer.email,
      line_items: lineItems,
      shipping_address_collection: { allowed_countries: ["AU"] },
      shipping_options: [{
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: chargedShippingCents, currency: "aud" },
          display_name: "Tracked delivery within Australia",
          delivery_estimate: {
            minimum: { unit: "business_day", value: 3 },
            maximum: { unit: "business_day", value: 8 },
          },
        },
      }],
      allow_promotion_codes: true,
      discounts: promotion ? [{ promotion_code: promotion.id }] : undefined,
      payment_intent_data: {
        receipt_email: customer.email,
        metadata: { shop: "framed-editions" },
      },
      invoice_creation: paidInvoicesEnabled() ? {
        enabled: true,
        invoice_data: {
          description: "Fine-art photographic print order",
          footer: "Thank you for supporting independent Australian photography.",
        },
      } : undefined,
      metadata,
      return_url: `${publicOrigin(req)}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    }, {
      idempotencyKey: `checkout-${crypto.randomUUID()}`,
    });

    json(res, 200, {
      clientSecret: session.client_secret,
      sessionId: session.id,
      shippingCents: chargedShippingCents,
      quoteSource: freeShippingPromotion ? `${shipping.source}+promotion-free-shipping` : shipping.source,
    });
  } catch (error) {
    const message = safeError(error);
    const status = /not valid|Enter |Cart |no longer available|unsupported|between 1|isn't available as a/i.test(message) ? 400 : 500;
    if (status === 500) console.error("create checkout session:", message);
    json(res, status, { error: status === 500 ? "Checkout could not be started. Please try again." : message });
  }
}
