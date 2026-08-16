import Stripe from "stripe";
import { normaliseCart } from "../server/shop/catalogue.mjs";
import { checkoutEnabled } from "../server/shop/features.mjs";
import { json, methodAllowed, publicOrigin, readJson, safeError } from "../server/shop/http.mjs";
import { sizeIsAvailable } from "../server/shop/printSizing.mjs";
import { quoteShippingCents } from "../server/shop/prodigi.mjs";
import { fetchShopPhotos, requireAdmin, shopRuntimeEnabled } from "../server/shop/supabase.mjs";

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
    address: {
      line1: clean(body?.customer?.address?.line1, 160),
      line2: clean(body?.customer?.address?.line2, 160),
      city: clean(body?.customer?.address?.city, 100),
      state: clean(body?.customer?.address?.state, 40).toUpperCase(),
      postal_code: clean(body?.customer?.address?.postalCode, 12),
      country: "AU",
    },
  };
  if (!customer.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new Error("Enter a valid name and email address.");
  if (!customer.address.line1 || !customer.address.city || !customer.address.state || !/^\d{4}$/.test(customer.address.postal_code)) {
    throw new Error("Enter a complete Australian shipping address.");
  }
  return customer;
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["POST"])) return;

  try {
    const environmentEnabled = checkoutEnabled();
    const runtimeEnabled = environmentEnabled ? await shopRuntimeEnabled() : false;
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
    const cart = normaliseCart(body.cart);
    const customer = customerFrom(body);
    const photos = await fetchShopPhotos(cart.map((item) => item.photoId));
    // Reject any size the photo's known resolution can't support at a
    // reasonable print quality — the size picker already hides these, this
    // is the real enforcement in case that's ever bypassed. Fail closed: a
    // photo with no known dimensions (backfill gap) can't be ordered at any
    // size, same as one that's genuinely too small.
    for (const item of cart) {
      const photo = photos.get(item.photoId);
      if (!sizeIsAvailable(photo.width, photo.height, item.size, item.mounted)) {
        throw new Error(`${photo.title} isn't available as a ${item.mounted ? "mounted " : ""}${item.size} print — the source image isn't high enough resolution for that size.`);
      }
    }
    const shipping = await quoteShippingCents(cart);
    const promoText = clean(body.promotionCode, 64).toUpperCase();
    let promotion = null;
    if (promoText) {
      const result = await stripe.promotionCodes.list({ code: promoText, active: true, limit: 1 });
      promotion = result.data[0] ?? null;
      if (!promotion) throw new Error("That promotion code is not valid.");
    }

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
      quote_source: shipping.source,
      promotion_code: promoText,
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
      shipping_options: [{
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: shipping.cents, currency: "aud" },
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
        shipping: {
          name: customer.name,
          phone: customer.phone || undefined,
          address: customer.address,
        },
        metadata: { shop: "framed-editions" },
      },
      metadata,
      return_url: `${publicOrigin(req)}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    }, {
      idempotencyKey: `checkout-${crypto.randomUUID()}`,
    });

    json(res, 200, {
      clientSecret: session.client_secret,
      sessionId: session.id,
      shippingCents: shipping.cents,
      quoteSource: shipping.source,
    });
  } catch (error) {
    const message = safeError(error);
    const status = /not valid|Enter |Cart |no longer available|unsupported|between 1|isn't available as a/i.test(message) ? 400 : 500;
    if (status === 500) console.error("create checkout session:", message);
    json(res, status, { error: status === 500 ? "Checkout could not be started. Please try again." : message });
  }
}
