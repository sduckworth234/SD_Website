// Real Frameshop.com.au print-fulfilment data, live-tested against their
// custom-picture-frames configurator on 2026-08-21 (frame 103RO — swapped
// from an initial 224RO pick, which turned out to be too thin a moulding to
// support the larger sizes: it triggered Frameshop's own "unsuitable frame"
// warning at A1/A2. 103RO — same Raw Oak finish, deeper 4cm profile — has no
// such limit and was re-verified at every size). Replaces the previous
// Prodigi-derived flat per-size price — see
// Shop Setup/prodigi-full-au-catalogue.json and "Prodigi API —
// Investigation & Setup Plan.md" for that history; Prodigi integration code
// (server/shop/prodigi.mjs) stays in place as a manual fallback while the
// Frameshop relationship is set up, but is no longer what customers are
// actually charged.
//
// Pricing is a FORMULA, not a lookup table — see priceCentsFor() below and
// supabase/migrations/20260902010000_pricing_repair_and_paper.sql for the
// exact math and where each number came from. Since 2026-09-02 the formula
// also carries the printing (paper) cost and a per-size artist fee, offers an
// unframed "print only" product, and rounds every result to a clean price
// point. It is mirrored, in integer cents, in server/shop/catalogue.mjs;
// scripts/pricing-parity.mjs asserts the two never drift. `outer`/`mat` below are kept
// from the Prodigi-era measurements (unchanged) — they only drive the room
// preview and DPI gating, not price.
//
// IMPORTANT: both frame cost AND glass cost are genuinely different mounted
// vs unmounted — not "unmounted cost, plus a mat on top" — because a mounted
// print needs a physically bigger frame and bigger glazing to cover the mat
// border, and Frameshop prices both by their actual size. An earlier version
// of this file used one glassCost for both, which silently undercharged
// every mounted order (verified: it priced A2 mounted Non-Reflective Glass
// at $152.60 when Frameshop's own real cost + 15% margin is $190.10).

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
  /** 103RO (wood) frame, in CENTS — the colour multiplier applies to this
   * alone. Different for mounted vs unmounted: the outer frame grows to
   * cover the mat border once mounted, so it costs more, not the same frame
   * "plus a mat" — two real, independently-priced Frameshop quotes. */
  frameCentsUnmounted: number;
  frameCentsMounted: number;
  /** Single mat at this size's `mat` width, neutral-white core — added only
   * when mounted. Mat colour doesn't change price, verified live. */
  matCents: number;
  /** Clear Glass baseline — the glazing multiplier applies to this. Also
   * genuinely different mounted vs unmounted (bigger glazing covers the mat
   * too) — see the file header for why this distinction matters. */
  glassCentsUnmounted: number;
  glassCentsMounted: number;
  /** The value of the photograph itself, on top of Frameshop's cost. Added
   * AFTER margin — margin covers the fulfilment cost, the artist fee isn't
   * marked up — so raising it raises the price dollar for dollar. */
  artistFeeCents: number;
};

/** Paper stock. Frameshop prices printing by paper AND size (Epson P20070),
 * so this is explicit per-size cents rather than a multiplier. Only two of
 * their five stocks are sold, kept deliberately simple: a photo finish and a
 * fine-art finish, not five variants to choose between. */
export type PaperId = "semi_gloss" | "high_gloss";

export type PrintPaper = { id: PaperId; label: string; description: string };

export const PAPERS: PrintPaper[] = [
  { id: "semi_gloss", label: "Semi-gloss luster", description: "A soft sheen with rich colour and low glare — the house standard." },
  { id: "high_gloss", label: "High-gloss metallic", description: "A metallic sheen with high contrast and depth — best under gallery lighting." },
];

export type Pricing = {
  components: Record<SizeId, SizeComponents>;
  /** Frame colour cost multipliers, applied to frame cost only. */
  colours: Record<ColourId, number>;
  /** Glazing cost multipliers, applied to glass cost only. */
  glazing: Record<GlazingId, number>;
  /** Printing cost in cents, per paper per size. */
  paper: Record<PaperId, Record<SizeId, number>>;
  marginPercent: number;
};

// THE fallback. Must stay byte-identical to server/shop/catalogue.mjs's
// FALLBACK_PRICING — scripts/pricing-parity.mjs asserts that for every
// size × mount × colour × glazing × paper × framed combination, and is the
// thing that makes it safe for this file and the checkout server to disagree
// about whether the live tables are reachable.
//
// Applied ALL-OR-NOTHING: fetchPricingSettings() in src/lib/supabase.ts
// either installs a complete live Pricing object or leaves this one whole.
// Mixing the two is what produced the 2026-09-02 incident, where the browser
// showed a price built from fallback components + live multipliers + a live
// 40% margin while checkout charged one built entirely from the 15%-margin
// fallback.
//
// Deliberately excludes shipping — that stays estimateShipping()'s job
// further down this file. Folding a shipping estimate into every item's unit
// price would double-charge shipping on any multi-item order, since
// estimateShipping() already gives real multi-item consolidation.
export const FALLBACK_PRICING: Pricing = {
  components: {
    A5: { frameCentsUnmounted: 3280, frameCentsMounted: 4370, matCents: 680, glassCentsUnmounted: 500, glassCentsMounted: 600, artistFeeCents: 2000 },
    A4: { frameCentsUnmounted: 5020, frameCentsMounted: 6880, matCents: 1200, glassCentsUnmounted: 700, glassCentsMounted: 800, artistFeeCents: 3500 },
    A3: { frameCentsUnmounted: 7210, frameCentsMounted: 8520, matCents: 1740, glassCentsUnmounted: 900, glassCentsMounted: 1400, artistFeeCents: 6000 },
    A2: { frameCentsUnmounted: 10050, frameCentsMounted: 12010, matCents: 2420, glassCentsUnmounted: 1900, glassCentsMounted: 2520, artistFeeCents: 11000 },
    A1: { frameCentsUnmounted: 14530, frameCentsMounted: 16600, matCents: 4360, glassCentsUnmounted: 3470, glassCentsMounted: 5150, artistFeeCents: 18000 },
  },
  colours: { natural: 1.0, black: 1.0, white: 1.0 },
  glazing: { clear: 1.0, non_reflective: 2.0, perspex: 2.0, uv_clear: 2.83, uv_non_reflective: 5.63, none: 0 },
  paper: {
    semi_gloss: { A5: 1020, A4: 1560, A3: 2730, A2: 4480, A1: 7680 },
    high_gloss: { A5: 1326, A4: 2028, A3: 3549, A2: 5824, A1: 9984 },
  },
  marginPercent: 40,
};

let ACTIVE_PRICING: Pricing = FALLBACK_PRICING;
let pricingVersion = 0;
const pricingListeners = new Set<() => void>();

/** Installs live pricing, or restores the complete fallback when passed null.
 * There is no partial path on purpose — see FALLBACK_PRICING's comment. */
export function applyLivePricing(pricing: Pricing | null): void {
  ACTIVE_PRICING = pricing ?? FALLBACK_PRICING;
  pricingVersion += 1;
  for (const listener of pricingListeners) listener();
}

export function activePricing(): Pricing {
  return ACTIVE_PRICING;
}

/** True while prices come from the hardcoded fallback rather than the live
 * tables — surfaced in the admin pricing panel so a silent fallback is
 * visible rather than invisible. */
export function pricingIsFallback(): boolean {
  return ACTIVE_PRICING === FALLBACK_PRICING;
}

// Live pricing lands asynchronously, after the first render. These let React
// re-render when it does (useSyncExternalStore in src/lib/usePricing.ts) —
// deliberately framework-free here so this module stays importable from a
// plain Node script for the parity test.
export function subscribePricing(listener: () => void): () => void {
  pricingListeners.add(listener);
  return () => pricingListeners.delete(listener);
}

export function pricingSnapshot(): number {
  return pricingVersion;
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
  /** Real Frameshop moulding code — kept for reference when ordering, never
   * shown to customers (frame/glazing UI uses the plain label only). */
  frameCode: string;
};

// Colour-matched against real Frameshop 103-series photos, rendered with a
// faint grain on wood so it reads as timber rather than paint.
export const COLOURS: FrameColour[] = [
  {
    id: "natural",
    label: "Wood",
    css: "linear-gradient(135deg,#d3b78c,#c2a175 45%,#a9865f)",
    grain: "repeating-linear-gradient(100deg, rgba(70,48,24,.05) 0px, rgba(70,48,24,.05) 1px, transparent 2px, transparent 6px, rgba(255,244,222,.07) 7px, transparent 9px)",
    frameCode: "103RO",
  },
  { id: "black", label: "Black", css: "linear-gradient(135deg,#2c2c2c,#141414)", frameCode: "103F" },
  { id: "white", label: "White", css: "linear-gradient(135deg,#f4f0e6,#dcd6c8)", frameCode: "103H" },
];

export type GlazingId = "clear" | "non_reflective" | "perspex" | "uv_clear" | "uv_non_reflective" | "none";

export type FrameGlazing = {
  id: GlazingId;
  label: string;
  description: string;
};

// Distinct from the site's existing "Canvas & glass" enquiry-only finishes
// (a different product — frameless glass prints) — this is the glazing that
// sits in front of any framed print.
export const GLAZING: FrameGlazing[] = [
  { id: "clear", label: "Clear Glass", description: "Standard 2mm clear framing glass — the most cost-effective option." },
  { id: "non_reflective", label: "Non-Reflective Glass", description: "2mm matte-coated glass that reduces glare — good for bright rooms." },
  { id: "perspex", label: "Clear Perspex (Acrylic)", description: "Lightweight, shatter-resistant 2–3mm acrylic with 94% UV resistance." },
  { id: "uv_clear", label: "UV Clear Glass", description: "2.5mm premium glass, 99% UV protection, same clear look as standard glass." },
  { id: "uv_non_reflective", label: "UV Non-Reflective Glass", description: "2.5mm glass combining anti-glare and 99% UV protection." },
  { id: "none", label: "No Glass", description: "An empty frame with no glazing — for canvas or already-protected artwork." },
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

export function paperById(id: PaperId): PrintPaper {
  const p = PAPERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown paper ${id}`);
  return p;
}

/** `framed: false` is the unframed "print only" product — a rolled print in
 * a tube, no frame, no mat, no glazing. */
export function skuFor(size: SizeId, mounted: boolean, framed = true): string {
  if (!framed) return `GLOBAL-PRINT-${size}`;
  return `GLOBAL-${mounted ? "CFPM" : "CFP"}-${size}`;
}

/** Round UP to the next whole $5, then take $1 off, so every customer-facing
 * figure is a clean price point: $176.17 -> $179, $48.33 -> $49. The single
 * place rounding happens in this runtime; server/shop/catalogue.mjs has the
 * identical function. */
export function roundToPricePoint(cents: number): number {
  if (cents <= 0) return 0;
  return Math.ceil(cents / 500) * 500 - 100;
}

export type PriceSpec = {
  size: SizeId;
  mounted: boolean;
  colour?: ColourId;
  glazing?: GlazingId;
  paper?: PaperId;
  /** false = print only (unframed, rolled). */
  framed?: boolean;
};

/**
 * THE formula. Mirrored exactly in server/shop/catalogue.mjs and documented
 * in supabase/migrations/20260902010000_pricing_repair_and_paper.sql — all
 * three must stay in sync, and all three work in integer cents so the price
 * the browser shows and the price checkout charges agree to the cent.
 *
 *   product_cost = frame(size, mounted) x colour_mult
 *                + (mounted ? mat : 0)
 *                + glass(size, mounted) x glazing_mult
 *                + paper(size)
 *   sell         = round_to_price_point(product_cost x (1 + margin%) + artist_fee)
 *
 * Print only (framed: false) zeroes frame, mat and glass, leaving paper +
 * artist fee. Shipping is NOT included — see estimateShipping() below, added
 * once per cart rather than once per item.
 */
export function priceCentsFor(spec: PriceSpec, pricing: Pricing = ACTIVE_PRICING): number {
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
 * — for the admin margin view and the pricing report, never shown publicly. */
export function productCostCentsFor(spec: PriceSpec, pricing: Pricing = ACTIVE_PRICING): number {
  const framed = spec.framed !== false;
  const mounted = framed && spec.mounted === true;
  const row = pricing.components[spec.size];
  const frameCents = framed ? Math.round((mounted ? row.frameCentsMounted : row.frameCentsUnmounted) * pricing.colours[spec.colour ?? "natural"]) : 0;
  const matCents = mounted ? row.matCents : 0;
  const glassCents = framed ? Math.round((mounted ? row.glassCentsMounted : row.glassCentsUnmounted) * pricing.glazing[spec.glazing ?? "clear"]) : 0;
  return frameCents + matCents + glassCents + pricing.paper[spec.paper ?? "semi_gloss"][spec.size];
}

/** One-line human description of a configuration, shared by the cart drawer
 * and the checkout summary so they never drift apart. */
export function specLabel(spec: PriceSpec): string {
  const paper = paperById(spec.paper ?? "semi_gloss").label;
  if (spec.framed === false) return `${spec.size} · Print only, rolled · ${paper}`;
  const colour = colourById(spec.colour ?? "natural").label;
  const glazing = glazingById(spec.glazing ?? "clear").label;
  return `${spec.size} · ${colour} · ${spec.mounted ? "Mounted" : "Unmounted"} · ${glazing} · ${paper}`;
}

/** Dollars, for display. Always a whole number given the rounding rule above.
 * Defaults match the configurator's initial selection, so existing callers
 * that only pass size/mount keep working unchanged. */
export function priceFor(
  size: SizeId,
  mounted: boolean,
  colour: ColourId = "natural",
  glazing: GlazingId = "clear",
  paper: PaperId = "semi_gloss",
  framed = true,
): number {
  return priceCentsFor({ size, mounted, colour, glazing, paper, framed }) / 100;
}

/** Cheapest framed price for a size/mount combo (any colour, Clear Glass,
 * house paper). Signature unchanged for existing "From $X" callers. */
export function cheapestPriceFor(size: SizeId, mounted = false, framed = true): number {
  if (!framed) return priceFor(size, false, "natural", "clear", "semi_gloss", false);
  return Math.min(...COLOURS.map((c) => priceFor(size, mounted, c.id, "clear")));
}

/** The genuinely cheapest way to own this size — which is now the unframed
 * rolled print — for "From $X" badges. */
export function cheapestPriceForSize(size: SizeId): number {
  return Math.min(
    cheapestPriceFor(size, false, false),
    cheapestPriceFor(size, false),
    cheapestPriceFor(size, true),
  );
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

/** Single framed item, AU Standard, in cents. The live quotes below were
 * $15.10 / $21.55; both are rounded UP to a whole dollar so nothing
 * customer-facing ever shows cents (see money()). */
function framedShipCentsFor(size: SizeId): number {
  return size === "A1" ? 2200 : 1600;
}

export type ShippingItem = { size: SizeId; framed?: boolean };

/**
 * AU Standard shipping for a whole order, in cents. Mirrored exactly in
 * server/shop/catalogue.mjs's estimateShippingCents().
 *
 * FRAMED prints, verified against 7 live quotes on api.sandbox.prodigi.com
 * (2026-08-14): 1×A3=$15.10 · 2×A3=$20.10 · A3+A5=$20.10 · 3×A3=$25.10
 * (linear, +$5 each) · 1×A1=$21.55 · A1+A3=$26.55 · A2+A1=$26.55 ·
 * 2×A1=$31.55 (+$10, not +$5 — two large parcels can't share a box). Rule:
 * every extra A5–A2 print costs $5, an extra A1 costs $5 unless another A1 is
 * already in the order, in which case $10. Bases rounded up to $16 / $22.
 *
 * PRINT ONLY ships rolled in a tube — much cheaper, and several rolled prints
 * go in one tube. A deliberately conservative tier: $12 base ($14 if any A1,
 * which needs a longer tube) plus $3 per extra rolled print. If the order
 * also contains a framed piece the framed rules govern and each rolled print
 * adds a flat $5, since it can't be assumed to travel inside the frame box.
 */
export function estimateShippingCents(items: ShippingItem[]): number {
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

/** Dollars, for display. Accepts bare sizes for older callers. */
export function estimateShipping(items: (ShippingItem | SizeId)[]): number {
  return estimateShippingCents(items.map((it) => (typeof it === "string" ? { size: it } : it))) / 100;
}

/** Whole dollars wherever the amount is whole — which, given the price-point
 * rounding and the whole-dollar shipping tiers, is everywhere customer-facing.
 * Falls back to cents only for an amount that genuinely has them (a live
 * Prodigi shipping quote, a promotional discount). Admin screens format cents
 * themselves and don't go through here. */
export const money = (n: number) => {
  const cents = Math.round(n * 100);
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
};

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
