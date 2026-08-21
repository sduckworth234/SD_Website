// Real Frameshop.com.au print-fulfilment data, live-tested against their
// custom-picture-frames configurator on 2026-08-21 (frame 224RO, the wood
// moulding Sam actually uses). Replaces the previous Prodigi-derived flat
// per-size price — see Shop Setup/prodigi-full-au-catalogue.json and
// "Prodigi API — Investigation & Setup Plan.md" for that history; Prodigi
// integration code (server/shop/prodigi.mjs) stays in place as a manual
// fallback while the Frameshop relationship is set up, but is no longer
// what customers are actually charged.
//
// Pricing is a FORMULA, not a lookup table — see priceFor() below and
// supabase/migrations/20260821030000_frameshop_print_pricing.sql for the
// exact math and where each number came from. `outer`/`mat` below are kept
// from the Prodigi-era measurements (unchanged) — they only drive the room
// preview and DPI gating, not price.

// Where enquiry emails go — the contact popup (App.tsx) and the shop product
// page's "need help?" card both compose to this inbox.

export type SizeId = "A5" | "A4" | "A3" | "A2" | "A1";

export type PrintSize = {
  id: SizeId;
  /** Outer finished-frame footprint in cm, [short edge, long edge]. Room
   * preview scaling only — not touched by the Frameshop pricing switch. */
  outer: [number, number];
  /** Mat border width in cm when mounted (single mat, uniform width) —
   * matches the width used to price Frameshop's "Mat (Top)" line below. */
  mat: number;
};

export const SIZES: PrintSize[] = [
  { id: "A5", outer: [14.8, 21.0], mat: 2.5 },
  { id: "A4", outer: [21.0, 29.7], mat: 3.7 },
  { id: "A3", outer: [29.7, 42.0], mat: 4.8 },
  { id: "A2", outer: [41.9, 59.4], mat: 5.0 },
  { id: "A1", outer: [59.4, 84.1], mat: 4.8 },
];

export type SizeComponents = {
  /** 224RO (wood), unmounted, in dollars — the colour multiplier applies to
   * this alone (mat/glass/backing cost the same regardless of frame colour,
   * verified live: Clear Glass was identically priced under 224RO and 224F). */
  frameCost: number;
  /** Single mat at this size's `mat` width, M-series neutral core — added
   * only when mounted. Mat colour (e.g. M47 Neutral White) doesn't change
   * price, verified live. */
  matCost: number;
  /** Clear Glass baseline — the glazing multiplier applies to this. */
  glassCost: number;
};

// Fallback only — shown before the live fetch from public.print_pricing_*
// resolves, or if it fails. applyLiveFrameshopPricing() patches this object
// in place once fetched (see fetchPricingSettings() in src/lib/supabase.ts).
// Checkout never trusts this — server/shop/catalogue.mjs reads the same
// tables independently for the amount actually charged.
//
// Deliberately excludes shipping — that stays estimateShipping()'s job
// further down this file (unchanged, still Prodigi-derived AU courier
// quotes). Folding a shipping estimate into every item's unit price here
// too would double-charge shipping on any multi-item order, since
// estimateShipping() already gives real multi-item consolidation (+$5 for
// most extra prints rather than a full shipping charge each).
export const PRICE_COMPONENTS: Record<SizeId, SizeComponents> = {
  A5: { frameCost: 21.90, matCost: 6.80, glassCost: 5.00 },
  A4: { frameCost: 31.70, matCost: 12.00, glassCost: 7.00 },
  A3: { frameCost: 45.90, matCost: 17.40, glassCost: 9.00 },
  A2: { frameCost: 70.50, matCost: 24.20, glassCost: 19.00 },
  A1: { frameCost: 109.80, matCost: 43.60, glassCost: 34.70 },
};

/** Percentage margin applied to (frame + mat + glass) cost. Mutable
 * fallback, patched live from site_settings.print_margin_percent. */
export let MARGIN_PERCENT = 15;

/** Patches PRICE_COMPONENTS/COLOURS/GLAZING/MARGIN_PERCENT in place from
 * live-fetched pricing data — mutates existing objects so every caller sees
 * the update without its own re-fetch plumbing. Missing/partial data for a
 * size/colour/glazing id leaves that entry's fallback value untouched. */
export function applyLiveFrameshopPricing(data: {
  components?: Partial<Record<SizeId, Partial<SizeComponents>>>;
  colours?: Partial<Record<ColourId, { costMultiplier?: number }>>;
  glazing?: Partial<Record<GlazingId, { costMultiplier?: number }>>;
  marginPercent?: number;
}): void {
  for (const size of SIZES) {
    const patch = data.components?.[size.id];
    if (!patch) continue;
    const target = PRICE_COMPONENTS[size.id];
    if (patch.frameCost != null) target.frameCost = patch.frameCost;
    if (patch.matCost != null) target.matCost = patch.matCost;
    if (patch.glassCost != null) target.glassCost = patch.glassCost;
  }
  for (const c of COLOURS) {
    const mult = data.colours?.[c.id]?.costMultiplier;
    if (mult != null) c.costMultiplier = mult;
  }
  for (const g of GLAZING) {
    const mult = data.glazing?.[g.id]?.costMultiplier;
    if (mult != null) g.costMultiplier = mult;
  }
  if (data.marginPercent != null) MARGIN_PERCENT = data.marginPercent;
}

/** Visible timber width carved out of the mounted border (portion of the mat
 * closest to the outer edge that reads as frame, not mat). */
export const MOULDING_CM = 1.0;
/** Thin frame-only edge when there's no mount (real "no mount" border ≈ 0). */
export const UNMOUNTED_BAND_CM = 0.5;

export type ColourId = "natural" | "black" | "white";

export type FrameColour = {
  id: ColourId;
  /** Shopper-facing label. */
  label: string;
  css: string;
  grain?: string;
  /** Real Frameshop moulding code — kept for reference when ordering. */
  frameCode: string;
  /** Multiplies SizeComponents.frameCost. Sampled once at A2 (224F/224RO
   * ratio was 0.774 unmounted, 0.831 mounted — 0.80 splits the difference).
   * 224H (white) shares 224F's Frameshop "Price Rate" so it's assumed to
   * share the multiplier too — not independently verified at every size. */
  costMultiplier: number;
};

// Colour-matched against real Frameshop 224-series photos, rendered with a
// faint grain on wood so it reads as timber rather than paint.
export const COLOURS: FrameColour[] = [
  {
    id: "natural",
    label: "Wood",
    css: "linear-gradient(135deg,#d3b78c,#c2a175 45%,#a9865f)",
    grain: "repeating-linear-gradient(100deg, rgba(70,48,24,.05) 0px, rgba(70,48,24,.05) 1px, transparent 2px, transparent 6px, rgba(255,244,222,.07) 7px, transparent 9px)",
    frameCode: "224RO",
    costMultiplier: 1.0,
  },
  { id: "black", label: "Black", css: "linear-gradient(135deg,#2c2c2c,#141414)", frameCode: "224F", costMultiplier: 0.8 },
  { id: "white", label: "White", css: "linear-gradient(135deg,#f4f0e6,#dcd6c8)", frameCode: "224H", costMultiplier: 0.8 },
];

export type GlazingId = "clear" | "non_reflective" | "perspex" | "uv_clear" | "uv_non_reflective";

export type FrameGlazing = {
  id: GlazingId;
  label: string;
  description: string;
  /** Multiplies SizeComponents.glassCost. Sampled once at A2 mounted
   * (Clear Glass $25.20 baseline): Non-Reflective $50.40 (2.00x), Clear
   * Perspex $50.60 (2.01x, rounded to 2.00), UV Clear $71.40 (2.83x),
   * UV Non-Reflective $141.80 (5.63x). */
  costMultiplier: number;
};

// Distinct from the site's existing "Canvas & glass" enquiry-only finishes
// (a different product — frameless glass prints) — this is the glazing that
// sits in front of any framed print.
export const GLAZING: FrameGlazing[] = [
  { id: "clear", label: "Clear Glass", description: "Standard 2mm clear framing glass — the most cost-effective option.", costMultiplier: 1.0 },
  { id: "non_reflective", label: "Non-Reflective Glass", description: "2mm matte-coated glass that reduces glare — good for bright rooms.", costMultiplier: 2.0 },
  { id: "perspex", label: "Clear Perspex (Acrylic)", description: "Lightweight, shatter-resistant 2–3mm acrylic with 94% UV resistance.", costMultiplier: 2.0 },
  { id: "uv_clear", label: "UV Clear Glass", description: "2.5mm premium glass, 99% UV protection, same clear look as standard glass.", costMultiplier: 2.83 },
  { id: "uv_non_reflective", label: "UV Non-Reflective Glass", description: "2.5mm glass combining anti-glare and 99% UV protection.", costMultiplier: 5.63 },
];

export function sizeById(id: SizeId): PrintSize {
  const s = SIZES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown size ${id}`);
  return s;
}

export function colourById(id: ColourId): FrameColour {
  const c = COLOURS.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown colour ${id}`);
  return c;
}

export function glazingById(id: GlazingId): FrameGlazing {
  const g = GLAZING.find((x) => x.id === id);
  if (!g) throw new Error(`Unknown glazing ${id}`);
  return g;
}

export function skuFor(size: SizeId, mounted: boolean): string {
  return `GLOBAL-${mounted ? "CFPM" : "CFP"}-${size}`;
}

/** sell_price = (frameCost*colourMult + (mounted?matCost:0) + glassCost*glazingMult)
 *             * (1 + MARGIN_PERCENT/100)
 * Rounded to the nearest cent. Shipping is NOT included — see
 * estimateShipping() below, added once per cart rather than once per item.
 * Defaults (natural/clear) match the configurator's initial selection, so
 * existing "from $X"-style callers that don't pass colour/glazing keep
 * working unchanged. */
export function priceFor(size: SizeId, mounted: boolean, colour: ColourId = "natural", glazing: GlazingId = "clear"): number {
  const c = PRICE_COMPONENTS[size];
  const colourDef = colourById(colour);
  const glazingDef = glazingById(glazing);
  const productCost = c.frameCost * colourDef.costMultiplier + (mounted ? c.matCost : 0) + c.glassCost * glazingDef.costMultiplier;
  const sell = productCost * (1 + MARGIN_PERCENT / 100);
  return Math.round(sell * 100) / 100;
}

/** The true cheapest price for a size/mount combo (any colour/glazing), for
 * "From $X" badges — always black/white frame (lower cost_multiplier than
 * wood) with Clear Glass (lowest glazing multiplier). */
export function cheapestPriceFor(size: SizeId, mounted = false): number {
  return Math.min(...COLOURS.map((c) => priceFor(size, mounted, c.id, "clear")));
}

// Room photo calibration: shot square-on (camera perpendicular to the wall,
// no vanishing lines) so a flat CSS rectangle sits correctly. Scale measured
// against the amber glass on the table (~9.5cm rocks glass = 73px tall at the
// image's native 928px width, grid-measured). Fixed centre point on the wall
// — every size grows/shrinks equally in all directions from here, matching
// how galleries actually hang work (same eye-level centre regardless of piece
// size). The corner side-table is confined to the bottom-left, well clear of
// this anchor, so even a portrait A1 never collides with furniture.
export const ROOM = {
  naturalW: 928,
  pxPerCmAtNative: 7.16,
  centerX: 0.580,
  centerY: 0.420,
  src: "/shop/room-corner.jpg",
};

/** Single-item AU Standard shipping (AUD) — $15.10 for A5–A2, $21.55 for A1. */
function baseShipFor(size: SizeId): number {
  return size === "A1" ? 21.55 : 15.10;
}

/**
 * AU Standard shipping for a whole order, verified against 7 live quotes on
 * api.sandbox.prodigi.com (2026-08-14):
 *   1×A3=$15.10 · 2×A3=$20.10 · A3+A5=$20.10 · 3×A3=$25.10 (linear, +$5 each)
 *   1×A1=$21.55 · A1+A3=$26.55 · A2+A1=$26.55 (+$5, order doesn't matter)
 *   2×A1=$31.55 (+$10, not +$5 — two large parcels can't share a box)
 * Rule: every extra A5–A2 print costs exactly $5.00. An extra A1 costs $5.00
 * unless another A1 is already in the order, in which case it's $10.00.
 */
export function estimateShipping(sizes: SizeId[]): number {
  if (!sizes.length) return 0;
  const sorted = [...sizes].sort((a, b) => baseShipFor(b) - baseShipFor(a));
  let total = baseShipFor(sorted[0]);
  let a1Count = sorted[0] === "A1" ? 1 : 0;
  for (const size of sorted.slice(1)) {
    if (size === "A1") {
      total += a1Count >= 1 ? 10 : 5;
      a1Count += 1;
    } else {
      total += 5;
    }
  }
  return total;
}

export const money = (n: number) => `$${n.toFixed(2)}`;

// Print-size gating — mirrored in server/shop/printSizing.mjs (server-only
// module system, can't share this file directly). Keep both in sync.
//
// Required print-area pixel dimensions at 300dpi per SKU, verified against
// the live Prodigi API (Shop Setup/Prodigi API — Investigation & Setup
// Plan.md §3). Same numbers AdminOrders.tsx validates a print-master upload
// against — this is that table's canonical home now.
export const REQUIRED_PX: Record<SizeId, { cfp: [number, number]; cfpm: [number, number] }> = {
  A5: { cfp: [1748, 2480], cfpm: [1164, 1890] },
  A4: { cfp: [2490, 3510], cfpm: [1594, 2622] },
  A3: { cfp: [3507, 4960], cfpm: [2385, 3825] },
  A2: { cfp: [4960, 7015], cfpm: [3780, 5835] },
  A1: { cfp: [7020, 9930], cfpm: [5895, 8805] },
};

/** Prodigi wants 300dpi, allows ~200dpi as the floor for non-fine-detail work
 * — but aerial/coastal work is all fine detail, so 200dpi is treated as the
 * hard floor below which a size isn't offered at all (Shop Setup doc §4). */
export const MIN_ACCEPTABLE_DPI = 200;

/** Achievable print dpi for a photo of the given pixel size at a given SKU,
 * per Shop Setup doc's formula: dpi = 300 * sqrt(actualMP / requiredMP@300dpi). */
export function dpiFor(width: number, height: number, size: SizeId, mounted: boolean): number {
  const [reqW, reqH] = mounted ? REQUIRED_PX[size].cfpm : REQUIRED_PX[size].cfp;
  return Math.round(300 * Math.sqrt((width * height) / (reqW * reqH)));
}

/** The largest size (of A5..A1) this photo can be sold at, at or above the
 * dpi floor, for a given mount option — or null if even A5 mounted can't
 * clear the floor. */
export function maxSellableSize(width: number, height: number, mounted: boolean): SizeId | null {
  let best: SizeId | null = null;
  for (const s of SIZES) {
    if (dpiFor(width, height, s.id, mounted) >= MIN_ACCEPTABLE_DPI) best = s.id;
  }
  return best;
}

/** Per-size availability at both mount options, for rendering the size
 * picker (disable unavailable options) and admin readiness displays. */
export function sizeAvailability(width: number, height: number): Record<SizeId, { cfpOk: boolean; cfpmOk: boolean; cfpDpi: number; cfpmDpi: number }> {
  const out = {} as Record<SizeId, { cfpOk: boolean; cfpmOk: boolean; cfpDpi: number; cfpmDpi: number }>;
  for (const s of SIZES) {
    const cfpDpi = dpiFor(width, height, s.id, false);
    const cfpmDpi = dpiFor(width, height, s.id, true);
    out[s.id] = { cfpOk: cfpDpi >= MIN_ACCEPTABLE_DPI, cfpmOk: cfpmDpi >= MIN_ACCEPTABLE_DPI, cfpDpi, cfpmDpi };
  }
  return out;
}

// --- Manual per-size overrides — supabase/migrations/20260816130000_photo_size_overrides.sql ---
// size_overrides is the admin's raw input; sellable_sizes is the derived,
// public-safe merge that the shop UI and checkout enforcement actually read.
// Mirrored in server/shop/printSizing.mjs.
export type SizeOverride = { unmounted?: boolean | null; mounted?: boolean | null };
export type SizeOverrides = Partial<Record<SizeId, SizeOverride>>;
export type SellableSizes = Record<SizeId, { unmounted: boolean; mounted: boolean }>;

/** Merge computed resolution with admin overrides into the single map the
 * rest of the app reads. Call this whenever dims or overrides change and
 * persist the result to photos.sellable_sizes (and refresh
 * max_sellable_mounted/unmounted from it too, for the simple "ideal size"
 * display). */
export function computeSellableSizes(width: number, height: number, overrides?: SizeOverrides | null): SellableSizes {
  const avail = sizeAvailability(width, height);
  const out = {} as SellableSizes;
  for (const s of SIZES) {
    const ov = overrides?.[s.id];
    out[s.id] = {
      unmounted: ov?.unmounted ?? avail[s.id].cfpOk,
      mounted: ov?.mounted ?? avail[s.id].cfpmOk,
    };
  }
  return out;
}

/** Largest sellable size for a mount option, from an already-resolved
 * sellable_sizes map — used for the simple "ideal size" label/sort, which
 * can't represent a non-monotonic override (e.g. A1 on but A2 off) as one
 * number, so it just reports the highest true. */
export function maxSellableFromSizes(sizes: SellableSizes | null | undefined, mounted: boolean): SizeId | null {
  if (!sizes) return null;
  let best: SizeId | null = null;
  for (const s of SIZES) if (sizes[s.id]?.[mounted ? "mounted" : "unmounted"]) best = s.id;
  return best;
}

/** Is this exact size/mount combo sellable? Prefers the resolved
 * sellable_sizes map (already override-aware); falls back to the plain
 * maxSellable label (pre-override data, or ships-ahead of the migration)
 * when sellable_sizes hasn't been computed for this photo yet. Missing or
 * unrecognised gating data fails closed so the client never promises a size
 * that the server-side resolution check could reject at checkout. */
export function isSizeSellable(
  size: SizeId,
  mounted: boolean,
  sellableSizes: SellableSizes | null | undefined,
  fallbackMax: string | null | undefined,
): boolean {
  if (sellableSizes) return Boolean(sellableSizes[size]?.[mounted ? "mounted" : "unmounted"]);
  if (fallbackMax == null) return false;
  if (!SIZES.some((s) => s.id === fallbackMax)) return false;
  return SIZES.findIndex((s) => s.id === size) <= SIZES.findIndex((s) => s.id === fallbackMax);
}
