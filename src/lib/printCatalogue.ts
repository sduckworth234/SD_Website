// Real Prodigi print-fulfilment data, pulled live from api.sandbox.prodigi.com
// on 2026-08-14 (see Shop Setup/prodigi-full-au-catalogue.json for the full
// 141-SKU pull). Scoped to the Classic frame range (GLOBAL-CFP / GLOBAL-CFPM),
// AU-fulfilled A5–A1 — see Shop Setup/Prodigi API — Investigation & Setup
// Plan.md §6 for why: best resolution economics, best 3:2 ratio fit, and the
// only range offering all colours at every AU-shippable size.

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

export const SIZES: PrintSize[] = [
  { id: "A5", outer: [14.8, 21.0], mat: 2.5, cfp: 51.10, cfpm: 57.10 },
  { id: "A4", outer: [21.0, 29.7], mat: 3.7, cfp: 57.10, cfpm: 57.10 },
  { id: "A3", outer: [29.7, 42.0], mat: 4.8, cfp: 75.10, cfpm: 77.10 },
  { id: "A2", outer: [41.9, 59.4], mat: 5.0, cfp: 95.10, cfpm: 110.10 },
  { id: "A1", outer: [59.4, 84.1], mat: 4.8, cfp: 136.55, cfpm: 161.55 },
];

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
