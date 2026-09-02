// Single server-side source of truth for every amount charged at checkout.
// The browser's CartItem.price is display-only; it is accepted only as an
// EXPECTED price to compare against (see normaliseCart), never as the amount.
//
// Pricing is a FORMULA (mirrors src/lib/printCatalogue.ts's priceCentsFor() —
// keep both in sync, and see supabase/migrations/
// 20260902010000_pricing_repair_and_paper.sql for the same formula written out
// and for where every number came from):
//
//   product_cost = frame(size, mounted) x colour_mult
//                + (mounted ? mat : 0)
//                + glass(size, mounted) x glazing_mult
//                + paper(size)
//   sell         = round_to_price_point(product_cost x (1 + margin%) + artist_fee)
//   round_to_price_point(c) = ceil(c / 500) * 500 - 100   (next $5, less $1)
//
// Everything is integer cents on both sides of the wire so the price the
// browser shows and the price this file charges agree to the cent.
//
// "Print only" (framed: false) is the unframed, rolled product: frame, mat and
// glazing all drop to zero, leaving paper + artist fee, and it ships in a tube
// on its own cheaper tier (see estimateShippingCents).
//
// Frame AND glass cost are genuinely different mounted vs unmounted (not
// "unmounted cost, plus a mat on top") — a mounted print needs a physically
// bigger frame and bigger glazing to cover the mat border, and Frameshop
// prices both by their real size.
//
// FALLBACK_PRICING below is the fallback only — the real, admin-editable
// values live in public.print_pricing_components / _colours / _glazing /
// _paper and site_settings.print_margin_percent. fetchPricing() reads those;
// every caller that charges money must fetch pricing and pass it through (see
// priceCentsFor/normaliseCart) rather than reading the constants directly, so
// a price edit takes effect without a redeploy. The constants exist only so
// checkout still works, at the last-known-good rate, if the tables are ever
// empty or unreachable — and they are byte-identical to the browser's
// FALLBACK_PRICING (scripts/pricing-parity.mjs asserts it), so a fallback on
// one side alone cannot produce a shown price that differs from the charged
// one. That mismatch is exactly what happened on 2026-09-02 and is what the
// expected-price check in normaliseCart now catches regardless.
export const FALLBACK_PRICING = Object.freeze({
  components: Object.freeze({
    A5: { frameCentsUnmounted: 3280, frameCentsMounted: 4370, matCents: 680, glassCentsUnmounted: 500, glassCentsMounted: 600, artistFeeCents: 2000 },
    A4: { frameCentsUnmounted: 5020, frameCentsMounted: 6880, matCents: 1200, glassCentsUnmounted: 700, glassCentsMounted: 800, artistFeeCents: 3500 },
    A3: { frameCentsUnmounted: 7210, frameCentsMounted: 8520, matCents: 1740, glassCentsUnmounted: 900, glassCentsMounted: 1400, artistFeeCents: 6000 },
    A2: { frameCentsUnmounted: 10050, frameCentsMounted: 12010, matCents: 2420, glassCentsUnmounted: 1900, glassCentsMounted: 2520, artistFeeCents: 11000 },
    A1: { frameCentsUnmounted: 14530, frameCentsMounted: 16600, matCents: 4360, glassCentsUnmounted: 3470, glassCentsMounted: 5150, artistFeeCents: 18000 },
  }),
  colours: Object.freeze({ natural: 1.0, black: 1.0, white: 1.0 }),
  glazing: Object.freeze({ clear: 1.0, non_reflective: 2.0, perspex: 2.0, uv_clear: 2.83, uv_non_reflective: 5.63, none: 0 }),
  paper: Object.freeze({
    semi_gloss: { A5: 1020, A4: 1560, A3: 2730, A2: 4480, A1: 7680 },
    high_gloss: { A5: 1326, A4: 2028, A3: 3549, A2: 5824, A1: 9984 },
  }),
  marginPercent: 40,
});

export const SIZE_IDS = Object.keys(FALLBACK_PRICING.components);
export const COLOURS = new Set(Object.keys(FALLBACK_PRICING.colours));
export const GLAZING = new Set(Object.keys(FALLBACK_PRICING.glazing));
export const PAPERS = new Set(Object.keys(FALLBACK_PRICING.paper));
export const DEFAULT_MARGIN_PERCENT = FALLBACK_PRICING.marginPercent;
export const MAX_CART_ITEMS = 20;

/** `framed: false` is the unframed "print only" product — rolled in a tube. */
export function skuFor(size, mounted, framed = true) {
  if (!framed) return `GLOBAL-PRINT-${size}`;
  return `GLOBAL-${mounted ? "CFPM" : "CFP"}-${size}`;
}

/** Round UP to the next whole $5, then take $1 off, so every customer-facing
 * figure is a clean price point: $176.17 -> $179, $48.33 -> $49. The single
 * place rounding happens in this runtime; src/lib/printCatalogue.ts has the
 * identical function. */
export function roundToPricePoint(cents) {
  if (cents <= 0) return 0;
  return Math.ceil(cents / 500) * 500 - 100;
}

// spec: { size, mounted, colour, glazing, paper, framed }
export function priceCentsFor(spec, pricing = FALLBACK_PRICING) {
  const framed = spec.framed !== false;
  const mounted = framed && spec.mounted === true;
  const row = pricing.components[spec.size];
  if (!row) throw new Error(`Unsupported print size: ${spec.size}`);
  const colourMult = pricing.colours[spec.colour ?? "natural"];
  if (colourMult == null) throw new Error(`Unsupported frame colour: ${spec.colour}`);
  const glazingMult = pricing.glazing[spec.glazing ?? "clear"];
  if (glazingMult == null) throw new Error(`Unsupported glazing: ${spec.glazing}`);
  const paperRow = pricing.paper[spec.paper ?? "semi_gloss"];
  if (!paperRow) throw new Error(`Unsupported paper: ${spec.paper}`);
  const paperCents = paperRow[spec.size];
  if (paperCents == null) throw new Error(`No paper cost for ${spec.paper} at ${spec.size}`);

  const frameCents = framed ? Math.round((mounted ? row.frameCentsMounted : row.frameCentsUnmounted) * colourMult) : 0;
  const matCents = mounted ? row.matCents : 0;
  const glassCents = framed ? Math.round((mounted ? row.glassCentsMounted : row.glassCentsUnmounted) * glazingMult) : 0;
  const productCostCents = frameCents + matCents + glassCents + paperCents;
  return roundToPricePoint(Math.round(productCostCents * (1 + pricing.marginPercent / 100)) + row.artistFeeCents);
}

/** Frameshop's own cost for this configuration, before margin and artist fee
 * — margin visibility only, never charged. */
export function productCostCentsFor(spec, pricing = FALLBACK_PRICING) {
  const framed = spec.framed !== false;
  const mounted = framed && spec.mounted === true;
  const row = pricing.components[spec.size];
  const frameCents = framed ? Math.round((mounted ? row.frameCentsMounted : row.frameCentsUnmounted) * pricing.colours[spec.colour ?? "natural"]) : 0;
  const matCents = mounted ? row.matCents : 0;
  const glassCents = framed ? Math.round((mounted ? row.glassCentsMounted : row.glassCentsUnmounted) * pricing.glazing[spec.glazing ?? "clear"]) : 0;
  return frameCents + matCents + glassCents + pricing.paper[spec.paper ?? "semi_gloss"][spec.size];
}

function framedShipCentsFor(size) {
  return size === "A1" ? 2200 : 1600;
}

/**
 * AU Standard shipping for a whole order, in cents. Mirrored exactly in
 * src/lib/printCatalogue.ts's estimateShippingCents().
 *
 * FRAMED prints, verified against 7 live quotes on api.sandbox.prodigi.com
 * (2026-08-14): every extra A5-A2 print costs $5, an extra A1 costs $5 unless
 * another A1 is already in the order, in which case $10. The $15.10 / $21.55
 * bases are rounded up to $16 / $22 so nothing customer-facing shows cents.
 *
 * PRINT ONLY ships rolled in a tube: $12 base ($14 if any A1, which needs a
 * longer tube) plus $3 per extra rolled print. If the order also contains a
 * framed piece the framed rules govern and each rolled print adds a flat $5,
 * since it can't be assumed to travel inside the frame box. Deliberately
 * conservative in both directions.
 */
export function estimateShippingCents(items) {
  if (!items.length) return 0;
  const framed = items.filter((it) => it.framed !== false);
  const rolled = items.filter((it) => it.framed === false);
  let total = 0;
  if (framed.length) {
    const sorted = [...framed].sort((a, b) => framedShipCentsFor(b.size) - framedShipCentsFor(a.size));
    total += framedShipCentsFor(sorted[0].size);
    let a1Count = sorted[0].size === "A1" ? 1 : 0;
    for (const item of sorted.slice(1)) {
      if (item.size === "A1") {
        total += a1Count >= 1 ? 1000 : 500;
        a1Count += 1;
      } else {
        total += 500;
      }
    }
    total += rolled.length * 500;
  } else {
    total += rolled.some((it) => it.size === "A1") ? 1400 : 1200;
    total += (rolled.length - 1) * 300;
  }
  return total;
}

export function normaliseCart(input, pricing = FALLBACK_PRICING) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_CART_ITEMS) {
    throw new Error(`Cart must contain between 1 and ${MAX_CART_ITEMS} prints.`);
  }
  return input.map((raw) => {
    const photoId = typeof raw?.photoId === "string" ? raw.photoId.trim() : "";
    const size = typeof raw?.size === "string" ? raw.size.toUpperCase() : "";
    // An unframed print has no frame to mount into. Normalise rather than
    // reject, so a stale cart from before "print only" existed still prices.
    const framed = raw?.framed !== false;
    const mounted = framed && raw?.mounted === true;
    const colour = typeof raw?.colour === "string" ? raw.colour.toLowerCase() : "";
    const glazing = typeof raw?.glazing === "string" ? raw.glazing.toLowerCase() : "clear";
    const paper = typeof raw?.paper === "string" ? raw.paper.toLowerCase() : "semi_gloss";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(photoId)) {
      throw new Error("Cart contains an invalid photo id.");
    }
    if (!pricing.components[size]) throw new Error("Cart contains an unsupported size.");
    if (!COLOURS.has(colour)) throw new Error("Cart contains an unsupported frame colour.");
    if (!GLAZING.has(glazing)) throw new Error("Cart contains an unsupported glazing.");
    if (!PAPERS.has(paper)) throw new Error("Cart contains an unsupported paper.");

    const unitPriceCents = priceCentsFor({ size, mounted, colour, glazing, paper, framed }, pricing);
    // The browser sends the price it displayed. If it doesn't match what this
    // file just computed, something has moved between the page load and the
    // checkout — an admin price edit, a pricing table that was unreachable for
    // one side, a stale localStorage cart — and the customer must not be
    // silently charged an amount they were never shown. (Prior to this check,
    // a shown $175.17 was charged as $134.09 for weeks.)
    const expected = Number(raw?.expectedPriceCents);
    if (Number.isFinite(expected) && Math.round(expected) !== unitPriceCents) {
      throw new Error("Prices have been updated — please review your cart before paying.");
    }

    return {
      photoId,
      size,
      mounted,
      colour,
      glazing,
      paper,
      framed,
      sku: skuFor(size, mounted, framed),
      unitPriceCents,
    };
  });
}

// Reads public.print_pricing_components/_colours/_glazing/_paper and
// site_settings.print_margin_percent. Falls back to the complete
// FALLBACK_PRICING above — ALL of it, margin included, never a mix — if any
// read is empty or unreachable, because checkout must never hard-fail over a
// pricing read. A fallback is logged loudly: it means the browser and this
// file may be pricing from different data, which is a live money bug, not a
// cosmetic one. Cached in-module for a short window so a burst of checkouts
// doesn't each pay a DB round trip for values that change rarely.
let pricingCache = null;
let pricingCacheAt = 0;
const PRICING_CACHE_MS = 30_000;

export async function fetchPricing(supabaseRest) {
  const now = Date.now();
  if (pricingCache && now - pricingCacheAt < PRICING_CACHE_MS) return pricingCache;
  try {
    const [componentRows, colourRows, glazingRows, paperRows, marginRows] = await Promise.all([
      supabaseRest("print_pricing_components?select=size,frame_cost_unmounted_cents,frame_cost_mounted_cents,mat_cost_cents,glass_cost_unmounted_cents,glass_cost_mounted_cents,artist_fee_cents"),
      supabaseRest("print_pricing_colours?select=id,cost_multiplier"),
      supabaseRest("print_pricing_glazing?select=id,cost_multiplier"),
      supabaseRest("print_pricing_paper?select=id,cost_a5_cents,cost_a4_cents,cost_a3_cents,cost_a2_cents,cost_a1_cents"),
      supabaseRest("site_settings?select=value&key=eq.print_margin_percent"),
    ]);
    if (!componentRows?.length) throw new Error("print_pricing_components table is empty.");
    if (!colourRows?.length) throw new Error("print_pricing_colours table is empty.");
    if (!glazingRows?.length) throw new Error("print_pricing_glazing table is empty.");
    if (!paperRows?.length) throw new Error("print_pricing_paper table is empty.");

    const components = {};
    for (const row of componentRows) {
      components[row.size] = {
        frameCentsUnmounted: row.frame_cost_unmounted_cents,
        frameCentsMounted: row.frame_cost_mounted_cents,
        matCents: row.mat_cost_cents,
        glassCentsUnmounted: row.glass_cost_unmounted_cents,
        glassCentsMounted: row.glass_cost_mounted_cents,
        artistFeeCents: row.artist_fee_cents,
      };
    }
    for (const size of SIZE_IDS) {
      const row = components[size];
      if (!row) throw new Error(`print_pricing_components is missing a row for ${size}.`);
      for (const [field, value] of Object.entries(row)) {
        if (!Number.isFinite(value)) throw new Error(`print_pricing_components.${field} is missing for ${size}.`);
      }
    }
    const colours = {};
    for (const row of colourRows) colours[row.id] = Number(row.cost_multiplier);
    for (const id of COLOURS) if (!Number.isFinite(colours[id])) throw new Error(`print_pricing_colours is missing ${id}.`);
    const glazing = {};
    for (const row of glazingRows) glazing[row.id] = Number(row.cost_multiplier);
    for (const id of GLAZING) if (!Number.isFinite(glazing[id])) throw new Error(`print_pricing_glazing is missing ${id}.`);
    const paper = {};
    for (const row of paperRows) {
      paper[row.id] = {
        A5: row.cost_a5_cents, A4: row.cost_a4_cents, A3: row.cost_a3_cents,
        A2: row.cost_a2_cents, A1: row.cost_a1_cents,
      };
    }
    for (const id of PAPERS) {
      if (!paper[id]) throw new Error(`print_pricing_paper is missing ${id}.`);
      for (const size of SIZE_IDS) if (!Number.isFinite(paper[id][size])) throw new Error(`print_pricing_paper.${id} has no ${size} cost.`);
    }
    const marginPercent = marginRows?.[0]?.value != null ? Number(marginRows[0].value) : DEFAULT_MARGIN_PERCENT;
    if (!Number.isFinite(marginPercent)) throw new Error("print_margin_percent is not a number.");

    const pricing = { components, colours, glazing, paper, marginPercent };
    pricingCache = pricing;
    pricingCacheAt = now;
    return pricing;
  } catch (error) {
    console.error(
      "PRICING FALLBACK — live print pricing could not be read, charging from the hardcoded constants instead. " +
      "If the browser can read the tables and this cannot, shown and charged prices can diverge. Cause:",
      error.message,
    );
    return FALLBACK_PRICING;
  }
}
