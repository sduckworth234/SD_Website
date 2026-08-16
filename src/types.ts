export type PhotoKind = "Drone" | "Landscape" | "Travel";

export type LocationBucket = string;

export type GalleryLocation = {
  id: string;
  slug: string;
  name: string;
  region: string;
  description?: string | null;
  sortOrder: number;
  // Order of this location in the home page map-promo "drone feed".
  mapFeedOrder?: number;
};

export type Photo = {
  id: string;
  title: string;
  slug: string;
  description?: string | null;
  location: LocationBucket;
  locationId?: string | null;
  kind: PhotoKind;
  year: string;
  aspect: "portrait" | "landscape" | "square" | "wide";
  // Exact image proportion (width / height, e.g. 1.5 for 3:2). Reserves the
  // tile's true shape before the image loads; null falls back to the aspect
  // bucket's nominal ratio.
  ratio?: number | null;
  featured?: boolean;
  published?: boolean;
  imageUrl: string;
  storagePath?: string;
  // Absolute path to the original full-res source file (admin-only; never sent
  // to the public gallery). The "find the original to sell a print" link.
  sourcePath?: string | null;
  // Capture date (YYYY-MM-DD) from EXIF, when known.
  capturedAt?: string | null;
  sortOrder?: number;
  // Drone flight height in metres above the takeoff point (DJI RelativeAltitude).
  // Null/absent for non-drone photos.
  relativeAltitude?: number | null;
  // Capture coordinates (decimal degrees). Null/absent when the source had no GPS.
  latitude?: number | null;
  longitude?: number | null;
  // Admin-picked feature photo for its location in the home page map promo feed.
  mapFeature?: boolean;
  // If set, pins this photo into its location's home collection card at this
  // order (asc). Null/absent = auto-fill by gallery order.
  collectionOrder?: number | null;
  // Sold as a Framed Edition print on /shop, and its manual order there (asc).
  inShop?: boolean;
  shopOrder?: number | null;
  // Ids of the Collections this photo belongs to (public.photo_series). A photo
  // can sit in several. Empty/absent = it only ever shows under "All work".
  collectionIds?: string[];
  // Largest size sellable at a decent print quality (>=200dpi), derived from
  // whichever source file is best (raw preferred, export fallback) — public,
  // safe: a size label leaks nothing about the source file itself. Null means
  // not even A5 clears the floor. See src/lib/printCatalogue.ts.
  maxSellableMounted?: string | null;
  maxSellableUnmounted?: string | null;
  // Admin-only fields below (never sent to the public gallery query) — the
  // raw-source audit's findings, kept alongside sourcePath for the same
  // "find the file to sell a print" purpose. See supabase/migrations/
  // 20260816010000_photo_raw_source.sql and 20260816020000_photo_source_dims.sql.
  rawSourcePath?: string | null;
  rawWidth?: number | null;
  rawHeight?: number | null;
  rawMatchConfidence?: string | null;
  rawMatchNotes?: string | null;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
};

// A gallery "Collection" — a trip or body of work, the second filter axis on
// /galleries above the location tabs. Stored in public.series (NOT "collections"
// — `photos.collection_order` already means the home page location cards).
export type Collection = {
  id: string;
  slug: string;
  name: string;
  // Big line in the rail: "2026", "Ongoing", "Road trips". Null shows name alone.
  period?: string | null;
  subtitle?: string | null;
  sortOrder: number;
  isVisible: boolean;
};

// One cached Instagram post (public.instagram_posts). The image is a path in
// the photos bucket, not an Instagram URL — theirs expire, ours don't, and it
// keeps every image on a domain the site's CSP already trusts.
export type InstagramPost = {
  id: string;
  caption?: string | null;
  permalink: string;
  mediaType?: string | null;
  postedAt?: string | null;
  storagePath?: string | null;
  // Engagement counts, when Instagram returns them. Null-safe: the strip simply
  // omits the row rather than showing zeros.
  likeCount?: number | null;
  commentsCount?: number | null;
  sortOrder: number;
};

// "2026 Europe" — the rail's big+small lines joined, and the gallery page title.
export function collectionTitle(collection: Collection): string {
  return [collection.period, collection.name].filter(Boolean).join(" ");
}

// A row from public.site_settings: visibility flags + small key/value settings
// (e.g. the chosen Framed Editions banner photos). Anon reads; admins write.
export type SiteSetting = {
  key: string;
  enabled: boolean;
  value: string | null;
  label: string | null;
};
