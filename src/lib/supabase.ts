import { createClient } from "@supabase/supabase-js";
import { fallbackLocations, photos as fallbackPhotos } from "../data/photos";
import type { GalleryLocation, Photo } from "../types";

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

  const [{ data: locations, error: locationError }, { data: photos, error: photoError }] =
    await Promise.all([
      supabase
        .from("locations")
        .select("id, slug, name, region, description, sort_order, map_feed_order")
        .eq("is_visible", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("photos")
        .select(
          "id, title, slug, description, location_id, kind, year_taken, aspect, storage_bucket, storage_path, image_url, relative_altitude_m, latitude, longitude, is_map_feature, is_featured, is_published, sort_order, locations(id, slug, name, region, description, sort_order)",
        )
        .eq("is_published", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false }),
    ]);

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

export async function getAdminPhotos() {
  if (!supabase) return [];

  // Admin-only fetch: includes source_path + captured_at (NOT in the public
  // query — source_path is a private drive path). Runs as the authenticated
  // (admin) role, which keeps full-table SELECT per the source_path migration.
  const { data, error } = await supabase
    .from("photos")
    .select(
      "id, title, slug, description, location_id, kind, year_taken, captured_at, aspect, storage_bucket, storage_path, source_path, image_url, relative_altitude_m, latitude, longitude, is_map_feature, is_featured, is_published, sort_order, locations(id, slug, name, region, description, sort_order)",
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as unknown as PhotoRow[]).map(mapPhoto);
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

export async function uploadPhotoAsset(file: File) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const safeName = slugify(file.name.replace(/\.[^/.]+$/, "")) || "photo";
  const path = `incoming/${Date.now()}-${safeName}.${extension}`;

  const { data, error } = await supabase.storage
    .from(photoBucket)
    .upload(path, file, {
      cacheControl: "31536000",
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
  storagePath: string;
  sourcePath?: string; // original filename, so manual uploads keep the link too
  isFeatured: boolean;
  isPublished: boolean;
}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const slugBase = slugify(input.title) || "untitled";
  const { error } = await supabase.from("photos").insert({
    title: input.title,
    slug: `${slugBase}-${Date.now()}`,
    description: input.description || null,
    location_id: input.locationId || null,
    kind: input.kind,
    year_taken: input.year || null,
    aspect: input.aspect,
    storage_bucket: photoBucket,
    storage_path: input.storagePath,
    source_path: input.sourcePath || null,
    is_featured: input.isFeatured,
    is_published: input.isPublished,
    created_by: user?.id ?? null,
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
    slug: `${slugify(title) || "untitled"}-${Date.now()}`,
  };
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

  // Remove the stored image (ignore if the object is already gone), then the row.
  if (storagePath) {
    await supabase.storage.from(photoBucket).remove([storagePath]);
  }

  const { error } = await supabase.from("photos").delete().eq("id", photoId);
  if (error) throw error;
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
      .order("sort_order", { ascending: true }),
    supabase
      .from("photos")
      .select(RECENT_SELECT)
      .eq("is_published", true)
      .not("location_id", "is", null)
      .order("created_at", { ascending: false })
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
  let ri = 0;
  for (let i = 0; i < limit; i += 1) {
    if (slots[i]) continue;
    while (ri < recent.length && placed.has(recent[ri].id)) ri += 1;
    if (ri < recent.length) {
      slots[i] = recent[ri];
      placed.add(recent[ri].id);
      ri += 1;
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
