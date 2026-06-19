// Browser-side mirror of the reverse geocoding in scripts/import-shoot.mjs, so a
// photo uploaded from the admin panel lands in the same location/title as one
// imported by the script. Used only in the admin upload flow (lazy-loaded).
//
// Convention (kept in sync with import-shoot.mjs `placement`): the gallery
// filter *category* = country for overseas work, suburb/town for local; the
// photo *title* = the precise place shown on the image.
//
// Nominatim usage policy: <=1 request/second and an identifying Referer. Browsers
// forbid setting User-Agent, but they send a Referer automatically (the live
// site), which satisfies the policy. We also cache by ~110 m coord bucket and
// serialise + rate-limit every call so a whole batch only makes a handful.

export type Placement = {
  country: string;
  isHome: boolean;
  category: string; // the gallery filter category (location name)
  title: string; // the precise place for the photo title
  region: string; // for any NEW location row we create
};

const DELAY_MS = 1200; // gap between distinct Nominatim calls
const TIMEOUT_MS = 9000; // never let a hung request stall the upload queue

const cache = new Map<string, Placement | null>();
// One promise chain so concurrent callers are paced one-at-a-time.
let chain: Promise<unknown> = Promise.resolve();

function tidy(s: unknown): string {
  return String(s ?? "")
    .replace(/[\/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Address = Record<string, string | undefined>;

// Turn a Nominatim address into { country, isHome, category, title, region }.
function placement(address: Address): Placement {
  const country = tidy(address.country);
  const isHome = /australia/i.test(country);
  const feature =
    address.attraction || address.tourism || address.leisure || address.natural ||
    address.beach || address.historic || address.neighbourhood || address.quarter || address.hamlet;
  const suburb = address.suburb || address.city_district || address.town || address.village || address.municipality;
  const locality = address.city || address.town || address.village || address.municipality;
  const region = address.state || address.county;

  let title: string | undefined;
  if (isHome) {
    title = feature || suburb || locality || country; // category already carries the suburb
  } else {
    title = feature && locality && feature !== locality ? `${feature}, ${locality}` : (feature || locality || region || country);
  }
  const category = isHome ? (suburb || locality || region || country) : (country || region || locality);
  return {
    country,
    isHome,
    category: tidy(category) || "Unsorted",
    title: tidy(title) || "Unsorted",
    region: tidy(region),
  };
}

// Reverse-geocode one coordinate. Returns null on any failure (no network, rate
// limited, blocked) — callers fall back to a manual location. Never throws.
export async function reverseGeocode(lat: number, lon: number): Promise<Placement | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`; // ~110 m buckets
  if (cache.has(key)) return cache.get(key) ?? null;

  const run = chain.then(async () => {
    // A sibling call for the same bucket may have filled the cache while we waited.
    if (cache.has(key)) return cache.get(key) ?? null;
    await new Promise((r) => setTimeout(r, DELAY_MS));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=16&accept-language=en`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        cache.set(key, null);
        return null;
      }
      const data = (await res.json()) as { address?: Address };
      const result = placement(data.address || {});
      cache.set(key, result);
      return result;
    } catch {
      // Don't poison the cache on transient network errors — a retry may work.
      return null;
    } finally {
      clearTimeout(timer);
    }
  });

  // Keep the chain alive regardless of this call's outcome.
  chain = run.catch(() => {});
  return run;
}
