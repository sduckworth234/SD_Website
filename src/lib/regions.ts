// The fixed region set `locations.region` is kept to. It exists so the places
// filter can scale: 28 place pills in one flat row is unreadable, five region
// pills that open onto their places is not.
//
// Nothing is hardcoded per PLACE — every region shown anywhere in the app is
// read off the DB `region` column. This list only supplies (a) the running
// order (geographically outward from home, then overseas) and (b) the options
// in the admin's region picker. A region the DB has but this list doesn't is
// still rendered; it just sorts last, alphabetically.
//
// Keep in sync with REGIONS in scripts/region-cleanup.mjs.
export const REGION_ORDER = [
  "Northern Beaches",
  "Sydney",
  "New South Wales",
  "Australia",
  "Europe",
] as const;

export type Region = string;

// Canonical order first, then anything unexpected, alphabetically.
export function sortRegions(regions: Iterable<Region>): Region[] {
  const rank = (region: Region) => {
    const index = (REGION_ORDER as readonly string[]).indexOf(region);
    return index === -1 ? REGION_ORDER.length : index;
  };
  return [...new Set([...regions].map((region) => region.trim()).filter(Boolean))].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );
}
