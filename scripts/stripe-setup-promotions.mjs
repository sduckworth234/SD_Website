#!/usr/bin/env node
// Create (or verify) the shop's standing promotions in Stripe.
//
//   node --env-file=.env.local scripts/stripe-setup-promotions.mjs
//
// Idempotent: it looks for the coupon by its metadata tag and the promotion
// code by its literal code, and only creates what is missing. Run it as often
// as you like; run it once against the live key to publish the promotion.
//
// The mode is whatever STRIPE_SECRET_KEY says — sk_test_ writes to test mode,
// sk_live_ writes to live mode. The script prints which one it used.
import Stripe from "stripe";

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error("STRIPE_SECRET_KEY is not set. Run with: node --env-file=.env.local scripts/stripe-setup-promotions.mjs");
  process.exit(1);
}
const DRY_RUN = process.env.DRY_RUN === "1";
const stripe = new Stripe(KEY);
const mode = KEY.startsWith("sk_live_") ? "LIVE" : "TEST";

const PROMOTIONS = [
  {
    tag: "first-print-10",
    code: "FIRSTPRINT",
    coupon: {
      percent_off: 10,
      duration: "once",
      name: "First print",
    },
    promotionCode: {
      // Stripe enforces this against the Customer attached to the Checkout
      // Session; api/create-checkout-session.mjs resolves-or-creates that
      // Customer from the buyer's email so the restriction actually bites.
      restrictions: { first_time_transaction: true },
    },
  },
];

async function findCoupon(tag) {
  for await (const coupon of stripe.coupons.list({ limit: 100 })) {
    if (coupon.metadata?.sd_promotion === tag && coupon.valid !== false) return coupon;
  }
  return null;
}

async function findPromotionCode(code) {
  const found = await stripe.promotionCodes.list({ code, limit: 1 });
  return found.data[0] ?? null;
}

async function ensure(definition) {
  const existingCode = await findPromotionCode(definition.code);
  if (existingCode) {
    const linked = existingCode.promotion?.coupon;
    console.log(`  promotion code ${definition.code} already exists (${existingCode.id}, active=${existingCode.active}, coupon=${typeof linked === "string" ? linked : linked?.id ?? "—"})`);
    const restricted = existingCode.restrictions?.first_time_transaction === true;
    const wanted = definition.promotionCode.restrictions?.first_time_transaction === true;
    if (restricted !== wanted) {
      console.warn(`  ! its first_time_transaction restriction is ${restricted}, expected ${wanted}. Stripe cannot change restrictions after creation — archive it in the Dashboard and re-run to replace it.`);
    }
    return existingCode;
  }
  let coupon = await findCoupon(definition.tag);
  if (coupon) {
    console.log(`  reusing coupon ${coupon.id} (${coupon.name})`);
  } else if (DRY_RUN) {
    console.log(`  [dry run] would create coupon ${definition.coupon.name}`);
    return null;
  } else {
    coupon = await stripe.coupons.create({
      ...definition.coupon,
      metadata: { sd_promotion: definition.tag },
    });
    console.log(`  created coupon ${coupon.id} (${coupon.name})`);
  }
  if (DRY_RUN) {
    console.log(`  [dry run] would create promotion code ${definition.code}`);
    return null;
  }
  // The current API wraps the coupon in a `promotion` object; the older
  // top-level `coupon` parameter is rejected outright.
  const promotionCode = await stripe.promotionCodes.create({
    ...definition.promotionCode,
    promotion: { type: "coupon", coupon: coupon.id },
    code: definition.code,
    metadata: { sd_promotion: definition.tag },
  });
  console.log(`  created promotion code ${definition.code} (${promotionCode.id})`);
  return promotionCode;
}

console.log(`Stripe ${mode} mode${DRY_RUN ? " — DRY RUN" : ""}`);
for (const definition of PROMOTIONS) {
  console.log(`${definition.code}:`);
  await ensure(definition);
}
console.log("Done.");
