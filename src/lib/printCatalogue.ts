// Real Prodigi print-fulfilment data, pulled live from api.sandbox.prodigi.com
// on 2026-08-14 (see Shop Setup/prodigi-full-au-catalogue.json for the full
// 141-SKU pull). Scoped to the Classic frame range (GLOBAL-CFP / GLOBAL-CFPM),
// AU-fulfilled A5–A1 — see Shop Setup/Prodigi API — Investigation & Setup
// Plan.md §6 for why: best resolution economics, best 3:2 ratio fit, and the
// only range offering all colours at every AU-shippable size.

// Where enquiry emails go — the contact popup (App.tsx) and the shop product
// page's "need help?" card both compose to this inbox.
export const CONTACT_EMAIL = "samduckworthphoto@gmail.com";

export type SizeId = "A5" | "A4" | "A3" | "A2" | "A1";

export type PrintSize = {
  id: SizeId;
  /** Outer finished-frame footprint in cm, [short edge, long edge]. This is
   * the true wall footprint — Prodigi's own productDimensions, confirmed
   * against the API to already include the frame moulding (an unmounted
   * print fills almost the entire outer size, so there's nothing left to add). */
  outer: [number, number];
  /** Mat border width in cm when mounted — DERIVED from the API, not
   * guessed: outer size minus (print-area px / 300dpi), per size. */
  mat: number;
  /** Landed price to Sydney, Standard shipping, item cost only (AUD). */
  cfp: number;
  cfpm: number;
};

// Prices below are the fallback only — display-purposes-only shown before
// the live fetch resolves, or if it fails. The real, editable prices live in
// public.print_pricing (supabase/migrations/20260817010000_print_pricing.sql,
// admin Pricing tab); applyLivePricing patches these objects in place once
// fetched (see getPrintPricing() in src/lib/supabase.ts, called from
// useSiteData). Checkout never trusts this — server/shop/catalogue.mjs reads
// the same table independently for the amount actually charged.
export const SIZES: PrintSize[] = [
  { id: "A5", outer: [14.8, 21.0], mat: 2.5, cfp: 51.10, cfpm: 57.10 },
  { id: "A4", outer: [21.0, 29.7], mat: 3.7, cfp: 57.10, cfpm: 57.10 },
  { id: "A3", outer: [29.7, 42.0], mat: 4.8, cfp: 75.10, cfpm: 77.10 },
  { id: "A2", outer: [41.9, 59.4], mat: 5.0, cfp: 95.10, cfpm: 110.10 },
  { id: "A1", outer: [59.4, 84.1], mat: 4.8, cfp: 136.55, cfpm: 161.55 },
];

/** Patches SIZES' cfp/cfpm in place from live-fetched prices — mutates the
 * existing objects (not the array reference) so components reading via
 * sizeById()/priceFor() see the update without needing their own re-fetch
 * plumbing. Missing/partial data for a size leaves that size's fallback
 * value untouched rather than blanking it. */
export function applyLivePricing(pricing: Partial<Record<SizeId, { cfp?: number; cfpm?: number }>>): void {
  for (const s of SIZES) {
    const p = pricing[s.id];
    if (p?.cfp != null) s.cfp = p.cfp;
    if (p?.cfpm != null) s.cfpm = p.cfpm;
  }
}

/** Visible timber width carved out of the mounted border (portion of the mat
 * closest to the outer edge that reads as frame, not mat). */
export const MOULDING_CM = 1.0;
/** Thin frame-only edge when there's no mount (real "no mount" border ≈ 0). */
export const UNMOUNTED_BAND_CM = 0.5;

export type ColourId = "natural" | "black" | "white";

export type FrameColour = {
  id: ColourId;
  /** Shopper-facing label — "natural" is Prodigi's real attribute value, but
   * customers think "wood", not the SKU vocabulary. */
  label: string;
  css: string;
  grain?: string;
};

// Curated down to 3 of the real 8 classic-frame colours: white, black and
// "natural" (Prodigi's pale-oak finish — not the darker "brown" option),
// colour-matched against a real Prodigi sample photo, rendered with a faint
// grain so it reads as timber rather than paint.
export const COLOURS: FrameColour[] = [
  {
    id: "natural",
    label: "Wood",
    css: "linear-gradient(135deg,#d3b78c,#c2a175 45%,#a9865f)",
    grain: "repeating-linear-gradient(100deg, rgba(70,48,24,.05) 0px, rgba(70,48,24,.05) 1px, transparent 2px, transparent 6px, rgba(255,244,222,.07) 7px, transparent 9px)",
  },
  { id: "black", label: "Black", css: "linear-gradient(135deg,#2c2c2c,#141414)" },
  { id: "white", label: "White", css: "linear-gradient(135deg,#f4f0e6,#dcd6c8)" },
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

export function skuFor(size: SizeId, mounted: boolean): string {
  return `GLOBAL-${mounted ? "CFPM" : "CFP"}-${size}`;
}

export function priceFor(size: SizeId, mounted: boolean): number {
  const s = sizeById(size);
  return mounted ? s.cfpm : s.cfp;
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
 * when sellable_sizes hasn't been computed for this photo yet; fails open
 * (true) when there's no gating data at all — never block on missing data. */
export function isSizeSellable(
  size: SizeId,
  mounted: boolean,
  sellableSizes: SellableSizes | null | undefined,
  fallbackMax: string | null | undefined,
): boolean {
  if (sellableSizes) return Boolean(sellableSizes[size]?.[mounted ? "mounted" : "unmounted"]);
  if (fallbackMax == null) return true;
  if (!SIZES.some((s) => s.id === fallbackMax)) return true;
  return SIZES.findIndex((s) => s.id === size) <= SIZES.findIndex((s) => s.id === fallbackMax);
}
