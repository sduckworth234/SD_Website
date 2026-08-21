// Single server-side source of truth for every amount charged at checkout.
// The browser's CartItem.price is display-only and is never accepted here.
//
// Pricing is a FORMULA (mirrors src/lib/printCatalogue.ts's priceFor() —
// keep both in sync, and see supabase/migrations/
// 20260821030000_frameshop_print_pricing.sql for where every number came
// from): real Frameshop.com.au costs (frame 103RO/103F/103H) for
// frame/mat/glass, times a colour multiplier and a glazing multiplier, plus
// a flat margin. Shipping is NOT part of this — see estimateShippingCents()
// below, which totals once per cart with real multi-item consolidation
// rather than once per item.
//
// Frame AND glass cost are genuinely different mounted vs unmounted (not
// "unmounted cost, plus a mat on top") — a mounted print needs a physically
// bigger frame and bigger glazing to cover the mat border, and Frameshop
// prices both by their real size. An earlier version of this file used one
// glassCents for both, which silently undercharged every mounted order.
//
// FRAMESHOP_COMPONENTS/FRAMESHOP_COLOURS/FRAMESHOP_GLAZING/DEFAULT_MARGIN_PERCENT
// below are the fallback only — the real, admin-editable values live in
// public.print_pricing_components / _colours / _glazing and
// site_settings.print_margin_percent. fetchPricing() reads those; every
// caller that charges money must fetch pricing and pass it through (see
// priceCentsFor/normaliseCart) rather than reading these constants directly,
// so a price edit takes effect without a redeploy. These constants exist
// only so checkout still works, at the last-known-good rate, if the tables
// are ever empty or unreachable.
export const FRAMESHOP_COMPONENTS = Object.freeze({
  A5: { frameCentsUnmounted: 3280, frameCentsMounted: 4370, matCents: 680, glassCentsUnmounted: 500, glassCentsMounted: 600 },
  A4: { frameCentsUnmounted: 5020, frameCentsMounted: 6880, matCents: 1200, glassCentsUnmounted: 700, glassCentsMounted: 800 },
  A3: { frameCentsUnmounted: 7210, frameCentsMounted: 8520, matCents: 1740, glassCentsUnmounted: 900, glassCentsMounted: 1400 },
  A2: { frameCentsUnmounted: 10050, frameCentsMounted: 12010, matCents: 2420, glassCentsUnmounted: 1900, glassCentsMounted: 2520 },
  A1: { frameCentsUnmounted: 14530, frameCentsMounted: 16600, matCents: 4360, glassCentsUnmounted: 3470, glassCentsMounted: 5150 },
});
export const FRAMESHOP_COLOURS = Object.freeze({
  natural: 1.0,
  black: 1.0,
  white: 1.0,
});
export const FRAMESHOP_GLAZING = Object.freeze({
  clear: 1.0,
  non_reflective: 2.0,
  perspex: 2.0,
  uv_clear: 2.83,
  uv_non_reflective: 5.63,
  none: 0,
});
export const DEFAULT_MARGIN_PERCENT = 15;

export const COLOURS = new Set(Object.keys(FRAMESHOP_COLOURS));
export const GLAZING = new Set(Object.keys(FRAMESHOP_GLAZING));
export const MAX_CART_ITEMS = 20;

export function skuFor(size, mounted) {
  return `GLOBAL-${mounted ? "CFPM" : "CFP"}-${size}`;
}

// pricing shape: { components: FRAMESHOP_COMPONENTS-like, colours: FRAMESHOP_COLOURS-like,
// glazing: FRAMESHOP_GLAZING-like, marginPercent: number }
const DEFAULT_PRICING = Object.freeze({
  components: FRAMESHOP_COMPONENTS,
  colours: FRAMESHOP_COLOURS,
  glazing: FRAMESHOP_GLAZING,
  marginPercent: DEFAULT_MARGIN_PERCENT,
});

export function priceCentsFor(size, mounted, colour, glazing, pricing = DEFAULT_PRICING) {
  const row = pricing.components[size];
  if (!row) throw new Error(`Unsupported print size: ${size}`);
  const colourMult = pricing.colours[colour];
  if (colourMult == null) throw new Error(`Unsupported frame colour: ${colour}`);
  const glazingMult = pricing.glazing[glazing];
  if (glazingMult == null) throw new Error(`Unsupported glazing: ${glazing}`);
  const frameCents = mounted ? row.frameCentsMounted : row.frameCentsUnmounted;
  const glassCents = mounted ? row.glassCentsMounted : row.glassCentsUnmounted;
  const productCostCents = frameCents * colourMult + (mounted ? row.matCents : 0) + glassCents * glazingMult;
  return Math.round(productCostCents * (1 + pricing.marginPercent / 100));
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

export function normaliseCart(input, pricing = DEFAULT_PRICING) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_CART_ITEMS) {
    throw new Error(`Cart must contain between 1 and ${MAX_CART_ITEMS} prints.`);
  }
  return input.map((raw) => {
    const photoId = typeof raw?.photoId === "string" ? raw.photoId.trim() : "";
    const size = typeof raw?.size === "string" ? raw.size.toUpperCase() : "";
    const mounted = raw?.mounted === true;
    const colour = typeof raw?.colour === "string" ? raw.colour.toLowerCase() : "";
    const glazing = typeof raw?.glazing === "string" ? raw.glazing.toLowerCase() : "clear";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(photoId)) {
      throw new Error("Cart contains an invalid photo id.");
    }
    if (!pricing.components[size]) throw new Error("Cart contains an unsupported size.");
    if (!COLOURS.has(colour)) throw new Error("Cart contains an unsupported frame colour.");
    if (!GLAZING.has(glazing)) throw new Error("Cart contains an unsupported glazing.");
    return {
      photoId,
      size,
      mounted,
      colour,
      glazing,
      sku: skuFor(size, mounted),
      unitPriceCents: priceCentsFor(size, mounted, colour, glazing, pricing),
    };
  });
}

// Reads public.print_pricing_components/_colours/_glazing and
// site_settings.print_margin_percent. Falls back to the hardcoded
// FRAMESHOP_* constants above, logging once, if any table is empty or
// unreachable — checkout must never hard-fail over a pricing read. Cached
// in-module for a short window so a burst of checkouts doesn't each pay a
// DB round trip for values that change rarely.
let pricingCache = null;
let pricingCacheAt = 0;
const PRICING_CACHE_MS = 30_000;

export async function fetchPricing(supabaseRest) {
  const now = Date.now();
  if (pricingCache && now - pricingCacheAt < PRICING_CACHE_MS) return pricingCache;
  try {
    const [componentRows, colourRows, glazingRows, marginRows] = await Promise.all([
      supabaseRest("print_pricing_components?select=size,frame_cost_unmounted_cents,frame_cost_mounted_cents,mat_cost_cents,glass_cost_unmounted_cents,glass_cost_mounted_cents"),
      supabaseRest("print_pricing_colours?select=id,cost_multiplier"),
      supabaseRest("print_pricing_glazing?select=id,cost_multiplier"),
      supabaseRest("site_settings?select=value&key=eq.print_margin_percent"),
    ]);
    if (!componentRows?.length) throw new Error("print_pricing_components table is empty.");
    if (!colourRows?.length) throw new Error("print_pricing_colours table is empty.");
    if (!glazingRows?.length) throw new Error("print_pricing_glazing table is empty.");

    const components = {};
    for (const row of componentRows) {
      components[row.size] = {
        frameCentsUnmounted: row.frame_cost_unmounted_cents,
        frameCentsMounted: row.frame_cost_mounted_cents,
        matCents: row.mat_cost_cents,
        glassCentsUnmounted: row.glass_cost_unmounted_cents,
        glassCentsMounted: row.glass_cost_mounted_cents,
      };
    }
    for (const size of Object.keys(FRAMESHOP_COMPONENTS)) {
      if (!components[size]) throw new Error(`print_pricing_components is missing a row for ${size}.`);
    }
    const colours = {};
    for (const row of colourRows) colours[row.id] = Number(row.cost_multiplier);
    const glazing = {};
    for (const row of glazingRows) glazing[row.id] = Number(row.cost_multiplier);
    const marginPercent = marginRows?.[0]?.value != null ? Number(marginRows[0].value) : DEFAULT_MARGIN_PERCENT;

    const pricing = { components, colours, glazing, marginPercent };
    pricingCache = pricing;
    pricingCacheAt = now;
    return pricing;
  } catch (error) {
    console.error("fetchPricing: falling back to hardcoded Frameshop constants —", error.message);
    return DEFAULT_PRICING;
  }
}
