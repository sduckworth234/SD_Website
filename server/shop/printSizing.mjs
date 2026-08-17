// Server-side mirror of the print-size gating logic in src/lib/printCatalogue.ts
// (client TS, can't be shared directly across the module-system boundary —
// keep both in sync). Same numbers AdminOrders.tsx validates a print-master
// upload against; see Shop Setup/Prodigi API — Investigation & Setup Plan.md §3-4.

export const REQUIRED_PX = {
  A5: { cfp: [1748, 2480], cfpm: [1164, 1890] },
  A4: { cfp: [2490, 3510], cfpm: [1594, 2622] },
  A3: { cfp: [3507, 4960], cfpm: [2385, 3825] },
  A2: { cfp: [4960, 7015], cfpm: [3780, 5835] },
  A1: { cfp: [7020, 9930], cfpm: [5895, 8805] },
};

export const SIZE_IDS = ["A5", "A4", "A3", "A2", "A1"];
export const MIN_ACCEPTABLE_DPI = 200;

export function dpiFor(width, height, size, mounted) {
  const [reqW, reqH] = mounted ? REQUIRED_PX[size].cfpm : REQUIRED_PX[size].cfp;
  return Math.round(300 * Math.sqrt((width * height) / (reqW * reqH)));
}

export function maxSellableSize(width, height, mounted) {
  let best = null;
  for (const size of SIZE_IDS) {
    if (dpiFor(width, height, size, mounted) >= MIN_ACCEPTABLE_DPI) best = size;
  }
  return best;
}

/** True if this photo (given its known pixel dims) can be sold at `size`/`mounted`. */
export function sizeIsAvailable(width, height, size, mounted) {
  if (!width || !height) return false;
  return dpiFor(width, height, size, mounted) >= MIN_ACCEPTABLE_DPI;
}

/** Real checkout enforcement — prefers the resolved sellable_sizes map
 * (already merges computed resolution with admin overrides, see
 * supabase/migrations/20260816130000_photo_size_overrides.sql), falls back
 * to a live DPI check from raw dims when sellable_sizes hasn't been computed
 * for this photo yet. Fails closed only when there's truly no data at all —
 * same posture as the pre-override version of this check. */
export function sizeIsSellable(photo, size, mounted) {
  if (photo.sellableSizes) {
    return Boolean(photo.sellableSizes[size]?.[mounted ? "mounted" : "unmounted"]);
  }
  return sizeIsAvailable(photo.width, photo.height, size, mounted);
}

/** Effective pixel dimensions to use for sizing a given photo row: prefer the
 * raw master, fall back to the export (source_path) dimensions when no raw
 * exists — see supabase/migrations/20260816010000_photo_raw_source.sql and
 * 20260816020000_photo_source_dims.sql. */
export function effectiveDims(photo) {
  return {
    width: photo.raw_width || photo.source_width || null,
    height: photo.raw_height || photo.source_height || null,
  };
}
