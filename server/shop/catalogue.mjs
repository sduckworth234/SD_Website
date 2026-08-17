// Single server-side source of truth for every amount charged at checkout.
// The browser's CartItem.price is display-only and is never accepted here.
//
// PRINT_SIZES below is the fallback only — the real prices live in
// public.print_pricing (supabase/migrations/20260817010000_print_pricing.sql),
// admin-editable from the Pricing tab. fetchPricing() reads that table;
// every caller that charges money must fetch pricing and pass it through
// (see priceCentsFor/normaliseCart) rather than reading PRINT_SIZES
// directly, so a price edit takes effect without a redeploy. This constant
// exists only so checkout still works, at the last-known-good rate, if the
// table is ever empty or unreachable — ships-ahead safe, same posture as
// this project's other "columns ship ahead of migration" fallbacks.
export const PRINT_SIZES = Object.freeze({
  A5: { cfpCents: 5110, cfpmCents: 5710 },
  A4: { cfpCents: 5710, cfpmCents: 5710 },
  A3: { cfpCents: 7510, cfpmCents: 7710 },
  A2: { cfpCents: 9510, cfpmCents: 11010 },
  A1: { cfpCents: 13655, cfpmCents: 16155 },
});

export const COLOURS = new Set(["natural", "black", "white"]);
export const MAX_CART_ITEMS = 20;

export function skuFor(size, mounted) {
  return `GLOBAL-${mounted ? "CFPM" : "CFP"}-${size}`;
}

export function priceCentsFor(size, mounted, pricing = PRINT_SIZES) {
  const row = pricing[size];
  if (!row) throw new Error(`Unsupported print size: ${size}`);
  return mounted ? row.cfpmCents : row.cfpCents;
}

export function estimateShippingCents(items) {
  if (!items.length) return 0;
  const sorted = [...items].sort((a, b) => (b.size === "A1" ? 1 : 0) - (a.size === "A1" ? 1 : 0));
  let total = sorted[0].size === "A1" ? 2155 : 1510;
  let a1Count = sorted[0].size === "A1" ? 1 : 0;
  for (const item of sorted.slice(1)) {
    if (item.size === "A1") {
      total += a1Count >= 1 ? 1000 : 500;
      a1Count += 1;
    } else {
      total += 500;
    }
  }
  return total;
}

export function normaliseCart(input, pricing = PRINT_SIZES) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_CART_ITEMS) {
    throw new Error(`Cart must contain between 1 and ${MAX_CART_ITEMS} prints.`);
  }
  return input.map((raw) => {
    const photoId = typeof raw?.photoId === "string" ? raw.photoId.trim() : "";
    const size = typeof raw?.size === "string" ? raw.size.toUpperCase() : "";
    const mounted = raw?.mounted === true;
    const colour = typeof raw?.colour === "string" ? raw.colour.toLowerCase() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(photoId)) {
      throw new Error("Cart contains an invalid photo id.");
    }
    if (!PRINT_SIZES[size]) throw new Error("Cart contains an unsupported size.");
    if (!COLOURS.has(colour)) throw new Error("Cart contains an unsupported frame colour.");
    return {
      photoId,
      size,
      mounted,
      colour,
      sku: skuFor(size, mounted),
      unitPriceCents: priceCentsFor(size, mounted, pricing),
    };
  });
}

// Reads public.print_pricing (sell_cents only — cost/shipping are
// admin-only, read via api/admin-pricing.mjs with the service-role key
// instead). Falls back to PRINT_SIZES, logging once, if the table is
// empty/unreachable — checkout must never hard-fail over a pricing read.
// Cached in-module for a short window so a burst of checkouts doesn't each
// pay a DB round trip for a value that changes rarely.
let pricingCache = null;
let pricingCacheAt = 0;
const PRICING_CACHE_MS = 30_000;

export async function fetchPricing(supabaseRest) {
  const now = Date.now();
  if (pricingCache && now - pricingCacheAt < PRICING_CACHE_MS) return pricingCache;
  try {
    const rows = await supabaseRest("print_pricing?select=size,mounted,sell_cents");
    if (!rows?.length) throw new Error("print_pricing table is empty.");
    const pricing = {};
    for (const row of rows) {
      pricing[row.size] ??= {};
      if (row.mounted) pricing[row.size].cfpmCents = row.sell_cents;
      else pricing[row.size].cfpCents = row.sell_cents;
    }
    for (const size of Object.keys(PRINT_SIZES)) {
      if (pricing[size]?.cfpCents == null || pricing[size]?.cfpmCents == null) {
        throw new Error(`print_pricing is missing a row for ${size}.`);
      }
    }
    pricingCache = pricing;
    pricingCacheAt = now;
    return pricing;
  } catch (error) {
    console.error("fetchPricing: falling back to hardcoded PRINT_SIZES —", error.message);
    return PRINT_SIZES;
  }
}
