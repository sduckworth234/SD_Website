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
};

// A row from public.site_settings: visibility flags + small key/value settings
// (e.g. the chosen Framed Editions banner photos). Anon reads; admins write.
export type SiteSetting = {
  key: string;
  enabled: boolean;
  value: string | null;
  label: string | null;
};
