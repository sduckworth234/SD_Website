import { createClient } from "@supabase/supabase-js";
import { fallbackLocations, photos as fallbackPhotos } from "../data/photos";
import type { GalleryLocation, Photo, SiteSetting } from "../types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY;
export const photoBucket =
  import.meta.env.VITE_SUPABASE_PHOTO_BUCKET ?? "photos";
export const siteUrl = import.meta.env.VITE_SITE_URL?.replace(/\/$/, "");

export const hasSupabaseEnv = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase = hasSupabaseEnv
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null;

export function getAdminRedirectUrl() {
  return `${siteUrl || window.location.origin}/admin`;
}

export function getTransformedPublicUrl(
  bucket: string,
  path: string,
  width = 1400,
  quality = 72,
) {
  if (!supabase) return "";

  // `contain` (with only a width) scales the image to that width and KEEPS its
  // true aspect ratio. `cover` here was a bug: with no height it center-cropped to
  // the original height, serving a wrong-aspect, zoomed image. Each component crops
  // for display via CSS object-fit, so the transform should only scale.
  const { data } = supabase.storage.from(bucket).getPublicUrl(path, {
    transform: {
      width,
      quality,
      resize: "contain",
    },
  });

  return data.publicUrl;
}

type PhotoRow = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  location_id: string | null;
  kind: Photo["kind"];
  year_taken: number | null;
  aspect: Photo["aspect"];
  ratio?: number | string | null;
  storage_bucket: string;
  storage_path: string | null;
  source_path: string | null;
  image_url: string | null;
  captured_at: string | null;
  relative_altitude_m: number | null;
  latitude: number | null;
  longitude: number | null;
  is_map_feature: boolean;
  is_featured: boolean;
  is_published: boolean;
  sort_order: number;
  collection_order: number | null;
  in_shop: boolean;
  shop_order: number | null;
  locations: {
    id: string;
    slug: string;
    name: string;
    region: string;
    description: string | null;
    sort_order: number;
  } | null;
};

type LocationRow = {
  id: string;
  slug: string;
  name: string;
  region: string;
  description: string | null;
  sort_order: number;
  map_feed_order: number | null;
};

function publicImageUrl(row: Pick<PhotoRow, "storage_bucket" | "storage_path" | "image_url">) {
  if (row.storage_path) {
    return getTransformedPublicUrl(row.storage_bucket, row.storage_path, 1800, 76);
  }

  return row.image_url ?? "";
}

function mapLocation(row: LocationRow): GalleryLocation {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    region: row.region,
    description: row.description,
    sortOrder: row.sort_order,
    mapFeedOrder: row.map_feed_order ?? 0,
  };
}

function mapPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    location: row.locations?.name ?? "Unsorted",
    locationId: row.location_id,
    kind: row.kind,
    year: row.year_taken?.toString() ?? "",
    aspect: row.aspect,
    // numeric comes back as a string from PostgREST.
    ratio: row.ratio != null ? Number(row.ratio) : null,
    featured: row.is_featured,
    published: row.is_published,
    imageUrl: publicImageUrl(row),
    storagePath: row.storage_path ?? undefined,
    sourcePath: row.source_path ?? null,
    capturedAt: row.captured_at ?? null,
    sortOrder: row.sort_order,
    relativeAltitude: row.relative_altitude_m,
    latitude: row.latitude,
    longitude: row.longitude,
    mapFeature: row.is_map_feature,
    collectionOrder: row.collection_order ?? null,
    inShop: row.in_shop ?? false,
    shopOrder: row.shop_order ?? null,
  };
}

export async function getGalleryData() {
  if (!supabase) {
    return {
      locations: fallbackLocations,
      photos: fallbackPhotos,
      source: "fallback" as const,
    };
  }

  const PUBLIC_PHOTO_COLUMNS =
    "id, title, slug, description, location_id, kind, year_taken, aspect, storage_bucket, storage_path, image_url, relative_altitude_m, latitude, longitude, is_map_feature, is_featured, is_published, sort_order, collection_order, in_shop, shop_order, locations(id, slug, name, region, description, sort_order)";
  const photoQuery = (columns: string) =>
    supabase!
      .from("photos")
      .select(columns)
      .eq("is_published", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

  // eslint-disable-next-line prefer-const
  let [{ data: locations, error: locationError }, { data: photos, error: photoError }] =
    await Promise.all([
      supabase
        .from("locations")
        .select("id, slug, name, region, description, sort_order, map_feed_order")
        .eq("is_visible", true)
        .order("sort_order", { ascending: true }),
      // `ratio` ships ahead of its migration — retry without it until the
      // column exists (otherwise the whole site would fall back to bundled
      // data over one missing column).
      photoQuery(`ratio, ${PUBLIC_PHOTO_COLUMNS}`),
    ]);
  if (photoError) {
    ({ data: photos, error: photoError } = await photoQuery(PUBLIC_PHOTO_COLUMNS));
  }

  if (locationError || photoError) {
    console.warn("Using fallback gallery data", locationError ?? photoError);
    return {
      locations: fallbackLocations,
      photos: fallbackPhotos,
      source: "fallback" as const,
    };
  }

  return {
    locations: (locations ?? []).map(mapLocation),
    photos: ((photos ?? []) as unknown as PhotoRow[]).map(mapPhoto),
    source: "supabase" as const,
  };
}

const ADMIN_SELECT =
  "id, title, slug, description, location_id, kind, year_taken, captured_at, aspect, storage_bucket, storage_path, source_path, image_url, relative_altitude_m, latitude, longitude, is_map_feature, is_featured, is_published, sort_order, collection_order, in_shop, shop_order";

export async function getAdminPhotos() {
  if (!supabase) return [];

  // Admin-only fetch: includes source_path + captured_at (NOT in the public
  // query — source_path is a private drive path). Reads the is_admin()-gated
  // `admin_photos` view (see the authenticated-hardening migration): the
  // authenticated role's direct column grant on `photos` excludes source_path,
  // so the view is the only path to it. Location names are joined client-side
  // (PostgREST can't always embed through a view).
  let { data, error } = await supabase
    .from("admin_photos")
    .select(ADMIN_SELECT)
    .order("created_at", { ascending: false });

  // Fallback for the window before the hardening migration is applied: the
  // view doesn't exist yet, but the old blanket grant still does.
  if (error) {
    ({ data, error } = await supabase
      .from("photos")
      .select(ADMIN_SELECT)
      .order("created_at", { ascending: false }));
  }
  if (error) throw error;

  const { data: locations, error: locationError } = await supabase
    .from("locations")
    .select("id, slug, name, region, description, sort_order");
  if (locationError) throw locationError;

  const locationById = new Map((locations ?? []).map((l) => [l.id, l]));
  return ((data ?? []) as unknown as PhotoRow[]).map((row) =>
    mapPhoto({ ...row, locations: row.location_id ? locationById.get(row.location_id) ?? null : null }),
  );
}

export async function isCurrentUserAdmin() {
  if (!supabase) return false;

  const { data, error } = await supabase.rpc("is_admin");
  if (error) return false;
  return Boolean(data);
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function uploadPhotoAsset(file: Blob, originalName: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const extension = file.type === "image/webp" ? "webp" : originalName.split(".").pop()?.toLowerCase() ?? "jpg";
  const safeName = slugify(originalName.replace(/\.[^/.]+$/, "")) || "photo";
  // A random token alongside the timestamp keeps batch uploads (many files
  // started in the same millisecond, possibly sharing a filename) from
  // colliding on the same path, which would fail the upsert:false upload.
  const token = Math.random().toString(36).slice(2, 8);
  const path = `incoming/${Date.now()}-${token}-${safeName}.${extension}`;

  const { data, error } = await supabase.storage
    .from(photoBucket)
    .upload(path, file, {
      cacheControl: "31536000",
      contentType: file.type || undefined,
      upsert: false,
    });

  if (error) throw error;
  return data.path;
}

export async function createPhotoRecord(input: {
  title: string;
  description?: string;
  locationId?: string;
  kind: Photo["kind"];
  year?: number;
  aspect: Photo["aspect"];
  ratio?: number | null;
  capturedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  relativeAltitude?: number | null;
  storagePath: string;
  sourcePath?: string; // original filename, so manual uploads keep the link too
  isFeatured: boolean;
  isPublished: boolean;
}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const slugBase = slugify(input.title) || "untitled";
  // created_by is stamped server-side (column default auth.uid()).
  const { error } = await supabase.from("photos").insert({
    title: input.title,
    slug: `${slugBase}-${Date.now()}`,
    description: input.description || null,
    location_id: input.locationId || null,
    kind: input.kind,
    year_taken: input.year || null,
    aspect: input.aspect,
    ratio: input.ratio ?? null,
    captured_at: input.capturedAt ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    relative_altitude_m: input.relativeAltitude ?? null,
    storage_bucket: photoBucket,
    storage_path: input.storagePath,
    source_path: input.sourcePath || null,
    is_featured: input.isFeatured,
    is_published: input.isPublished,
  });

  if (error) throw error;
}

export async function updatePhotoVisibility(
  photoId: string,
  input: { featured: boolean; published: boolean },
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error } = await supabase
    .from("photos")
    .update({
      is_featured: input.featured,
      is_published: input.published,
    })
    .eq("id", photoId);

  if (error) throw error;
}

// Toggle whether a photo is the admin-picked feature for its location in the
// home page map-promo "drone feed".
export async function setMapFeature(photoId: string, value: boolean) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase
    .from("photos")
    .update({ is_map_feature: value })
    .eq("id", photoId);
  if (error) throw error;
}

// Set a location's position in the map-promo feed (lower = earlier).
export async function setLocationFeedOrder(locationId: string, order: number) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase
    .from("locations")
    .update({ map_feed_order: order })
    .eq("id", locationId);
  if (error) throw error;
}

// Edit every field on a photo from the admin panel. Title/description/location/
// year/aspect always write; the rest only write when the caller includes them
// (use `undefined` to leave a field untouched, `null` to clear it).
export async function updatePhotoDetails(
  photoId: string,
  input: {
    title: string;
    description?: string;
    locationId?: string;
    year?: number;
    aspect: Photo["aspect"];
    kind?: Photo["kind"];
    capturedAt?: string | null;
    relativeAltitude?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    sourcePath?: string | null;
    sortOrder?: number;
    isFeatured?: boolean;
    isPublished?: boolean;
    isMapFeature?: boolean;
    // Pass the photo's current title so the slug only regenerates on rename,
    // not on every save (slugs should stay stable).
    previousTitle?: string;
  },
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const title = input.title.trim() || "Untitled";
  const updates: Record<string, unknown> = {
    title,
    description: input.description?.trim() || null,
    location_id: input.locationId || null,
    year_taken: input.year || null,
    aspect: input.aspect,
  };
  if (input.previousTitle === undefined || title !== input.previousTitle) {
    updates.slug = `${slugify(title) || "untitled"}-${Date.now()}`;
  }
  if (input.kind) updates.kind = input.kind;
  if (input.capturedAt !== undefined) updates.captured_at = input.capturedAt || null;
  if (input.relativeAltitude !== undefined) updates.relative_altitude_m = input.relativeAltitude;
  if (input.latitude !== undefined) updates.latitude = input.latitude;
  if (input.longitude !== undefined) updates.longitude = input.longitude;
  if (input.sourcePath !== undefined) updates.source_path = input.sourcePath?.trim() || null;
  if (input.sortOrder !== undefined && Number.isFinite(input.sortOrder)) updates.sort_order = input.sortOrder;
  if (input.isFeatured !== undefined) updates.is_featured = input.isFeatured;
  if (input.isPublished !== undefined) updates.is_published = input.isPublished;
  if (input.isMapFeature !== undefined) updates.is_map_feature = input.isMapFeature;

  const { error } = await supabase.from("photos").update(updates).eq("id", photoId);
  if (error) throw error;
}

export async function updatePhotoCuration(
  photoIds: string[],
  input: { featured?: boolean; published?: boolean; sortOrder?: number },
) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!photoIds.length) return;

  const updates: Record<string, boolean | number> = {};
  if (typeof input.featured === "boolean") updates.is_featured = input.featured;
  if (typeof input.published === "boolean") updates.is_published = input.published;
  if (typeof input.sortOrder === "number") updates.sort_order = input.sortOrder;

  const { error } = await supabase
    .from("photos")
    .update(updates)
    .in("id", photoIds);

  if (error) throw error;
}

// "Send to top" curation: give the photo a sort_order below every other photo
// so it leads its category (the gallery is ordered by sort_order ascending).
// Doing it globally keeps each category's relative order intact while letting
// the admin promote favourites to the front of whichever category is shown.
export async function sendPhotoToTop(photoId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error: readError } = await supabase
    .from("photos")
    .select("sort_order")
    .order("sort_order", { ascending: true })
    .limit(1);
  if (readError) throw readError;

  const min = data?.[0]?.sort_order ?? 0;
  const { error } = await supabase
    .from("photos")
    .update({ sort_order: min - 1 })
    .eq("id", photoId);
  if (error) throw error;
}

export async function deletePhoto(photoId: string, storagePath?: string | null) {
  if (!supabase) throw new Error("Supabase is not configured.");

  // Row first, storage second: if the row delete fails the photo stays intact,
  // and a failed storage cleanup only leaves an orphaned object (harmless)
  // rather than a live row pointing at a missing file.
  const { error } = await supabase.from("photos").delete().eq("id", photoId);
  if (error) throw error;

  if (storagePath) {
    const { error: removeError } = await supabase.storage.from(photoBucket).remove([storagePath]);
    if (removeError) console.warn("Photo row deleted but storage cleanup failed", removeError);
  }
}

export async function createLocation(name: string, region = "Northern Beaches") {
  if (!supabase) throw new Error("Supabase is not configured.");
  const clean = name.trim();
  if (!clean) throw new Error("Enter a location name.");

  const { data: existing } = await supabase.from("locations").select("sort_order");
  const nextSort =
    (existing ?? []).reduce((max, l) => Math.max(max, l.sort_order ?? 0), 0) + 1;

  const { error } = await supabase.from("locations").insert({
    name: clean,
    slug: slugify(clean),
    region,
    sort_order: nextSort,
    is_visible: true,
  });
  if (error) throw error;
}

// Find a location by name (case-insensitive), creating it if absent, and return
// its id. Used by the batch uploader to resolve a reverse-geocoded or manually
// typed location name into a real row in one call. Mirrors ensureLocation in
// scripts/import-shoot.mjs.
export async function ensureLocation(name: string, region = "Northern Beaches"): Promise<string> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const clean = name.trim();
  if (!clean) throw new Error("Enter a location name.");

  // ilike with no wildcards = a plain case-insensitive equality test. Location
  // names don't contain % or _, so this is safe.
  const { data: existing, error: findError } = await supabase
    .from("locations")
    .select("id")
    .ilike("name", clean)
    .limit(1);
  if (findError) throw findError;
  if (existing && existing.length) return existing[0].id as string;

  const { data: all } = await supabase.from("locations").select("sort_order");
  const nextSort = (all ?? []).reduce((max, l) => Math.max(max, l.sort_order ?? 0), 0) + 1;

  const { data, error } = await supabase
    .from("locations")
    .insert({ name: clean, slug: slugify(clean), region: region || "Northern Beaches", sort_order: nextSort, is_visible: true })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function bulkEditPhotos(
  photoIds: string[],
  input: { title?: string; locationId?: string | null },
) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!photoIds.length) return;

  const updates: Record<string, string | null> = {};
  if (typeof input.title === "string") updates.title = input.title.trim() || "Untitled";
  if (input.locationId !== undefined) updates.location_id = input.locationId || null;
  if (!Object.keys(updates).length) return;

  const { error } = await supabase.from("photos").update(updates).in("id", photoIds);
  if (error) throw error;
}

const RECENT_SELECT =
  "id, title, slug, description, location_id, kind, year_taken, aspect, storage_bucket, storage_path, image_url, relative_altitude_m, latitude, longitude, is_map_feature, is_featured, is_published, sort_order, locations(id, slug, name, region, description, sort_order)";

// The "Recent Work" mosaic: admin-pinned photos (is_featured) sit in their
// chosen slot (sort_order 1..limit); any empty slots are filled with the most
// recent published photos.
export async function getRecentPhotos(limit = 5): Promise<Photo[]> {
  if (!supabase) return [];

  const [pinnedResult, recentResult] = await Promise.all([
    supabase
      .from("photos")
      .select(RECENT_SELECT)
      .eq("is_published", true)
      .eq("is_featured", true)
      // Unsorted (no location) is never public — even when pinned.
      .not("location_id", "is", null)
      .order("sort_order", { ascending: true }),
    supabase
      .from("photos")
      .select(RECENT_SELECT)
      .eq("is_published", true)
      .not("location_id", "is", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(limit * 3),
  ]);

  const pinned = ((pinnedResult.data ?? []) as unknown as PhotoRow[]).map(mapPhoto);
  const recent = ((recentResult.data ?? []) as unknown as PhotoRow[]).map(mapPhoto);

  // Place each pin at its EXACT slot. sort_order encodes the slot (1..limit) — but
  // it's also the global gallery-order field, so a featured photo that was later
  // "sent to top" carries an out-of-range value (e.g. -14). Such photos must NOT
  // grab/cascade slots (that shifted every tile down by one), so we ignore any
  // sort_order outside 1..limit here and let those slots fall to the recent fill.
  const slots: (Photo | null)[] = new Array(limit).fill(null);
  for (const photo of pinned) {
    const slot = photo.sortOrder ?? 0;
    if (Number.isInteger(slot) && slot >= 1 && slot <= limit && !slots[slot - 1]) {
      slots[slot - 1] = photo;
    }
  }

  const placed = new Set(slots.filter(Boolean).map((p) => (p as Photo).id));

  // The 9-tile mosaic has wide 2-col banners at tiles 1, 5, 9 (slots 0, 4, 8) —
  // those want landscape photos; the rest take the others. Fill deterministically
  // (recent is ordered by date then id) so the layout never reshuffles on refresh.
  const wideSlots = limit === 9 ? new Set([0, 4, 8]) : new Set<number>();
  const isWide = (p: Photo) => p.aspect === "landscape" || p.aspect === "wide";
  const avail = recent.filter((p) => !placed.has(p.id));
  const wideQueue = avail.filter(isWide);
  const narrowQueue = avail.filter((p) => !isWide(p));
  let wi = 0;
  let ni = 0;
  const nextWide = () => (wi < wideQueue.length ? wideQueue[wi++] : null);
  const nextNarrow = () => (ni < narrowQueue.length ? narrowQueue[ni++] : null);
  for (let i = 0; i < limit; i += 1) {
    if (slots[i]) continue;
    const pick = wideSlots.has(i) ? (nextWide() ?? nextNarrow()) : (nextNarrow() ?? nextWide());
    if (pick) {
      slots[i] = pick;
      placed.add(pick.id);
    }
  }

  return slots.filter(Boolean) as Photo[];
}

// Pin a photo into a Recent Work slot (1-based), replacing whatever was there.
export async function assignRecentSlot(slot: number, photoId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error: clearError } = await supabase
    .from("photos")
    .update({ is_featured: false })
    .eq("is_featured", true)
    .eq("sort_order", slot);
  if (clearError) throw clearError;

  const { error } = await supabase
    .from("photos")
    .update({ is_featured: true, sort_order: slot })
    .eq("id", photoId);
  if (error) throw error;
}

export async function setHeroSlot(photoId: string, slot: 1 | 2 | 3) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error: clearError } = await supabase
    .from("photos")
    .update({ is_featured: false })
    .eq("is_featured", true)
    .eq("sort_order", slot);

  if (clearError) throw clearError;

  const { error } = await supabase
    .from("photos")
    .update({
      is_featured: true,
      is_published: true,
      sort_order: slot,
    })
    .eq("id", photoId);

  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Phase 3: home collection curation, shop curation, and site visibility flags.
// ---------------------------------------------------------------------------

// Pin an explicit, ordered set of photos into a location's home collection card
// (the slowly-cycling tile). Clears the location's previous pins first, then
// numbers the picks 1..N. With no picks the card falls back to gallery order.
export async function setCollectionPicks(locationId: string, orderedPhotoIds: string[]) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error: clearError } = await supabase
    .from("photos")
    .update({ collection_order: null })
    .eq("location_id", locationId)
    .not("collection_order", "is", null);
  if (clearError) throw clearError;

  for (let i = 0; i < orderedPhotoIds.length; i += 1) {
    const { error } = await supabase
      .from("photos")
      .update({ collection_order: i + 1 })
      .eq("id", orderedPhotoIds[i]);
    if (error) throw error;
  }
}

// Toggle whether a photo is sold on /shop, and/or set its manual shop order.
export async function setPhotoShop(
  photoId: string,
  input: { inShop?: boolean; shopOrder?: number | null },
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const updates: Record<string, boolean | number | null> = {};
  if (typeof input.inShop === "boolean") updates.in_shop = input.inShop;
  if (input.shopOrder !== undefined) updates.shop_order = input.shopOrder;
  if (!Object.keys(updates).length) return;

  const { error } = await supabase.from("photos").update(updates).eq("id", photoId);
  if (error) throw error;
}

// Read every site_settings row (visibility flags + small key/value settings).
// Public-safe: anon may read. Returns [] when Supabase isn't configured.
export async function getSiteSettings(): Promise<SiteSetting[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("site_settings")
    .select("key, enabled, value, label");
  if (error) {
    console.warn("Could not read site settings", error);
    return [];
  }
  return (data ?? []) as SiteSetting[];
}

// Flip a visibility flag on/off (admin only — enforced by RLS).
export async function setSiteFlag(key: string, enabled: boolean) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase
    .from("site_settings")
    .upsert({ key, enabled }, { onConflict: "key" });
  if (error) throw error;
}

// Set a key/value setting, e.g. the chosen banner photo ids (admin only).
export async function setSiteSetting(key: string, value: string | null) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase
    .from("site_settings")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) throw error;
}
