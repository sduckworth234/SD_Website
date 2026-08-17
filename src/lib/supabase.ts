import { createClient } from "@supabase/supabase-js";
import { fallbackLocations, photos as fallbackPhotos } from "../data/photos";
import type { Collection, GalleryLocation, InstagramPost, Photo, RealPrintPhoto, SiteSetting } from "../types";
import { applyLivePricing, computeSellableSizes, maxSellableFromSizes } from "./printCatalogue";
import type { SellableSizes, SizeId, SizeOverrides } from "./printCatalogue";

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
  max_sellable_mounted?: string | null;
  max_sellable_unmounted?: string | null;
  sellable_sizes?: SellableSizes | null;
  size_overrides?: SizeOverrides | null;
  raw_source_path?: string | null;
  raw_width?: number | null;
  raw_height?: number | null;
  raw_match_confidence?: string | null;
  raw_match_notes?: string | null;
  source_width?: number | null;
  source_height?: number | null;
  created_at?: string | null;
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
    maxSellableMounted: row.max_sellable_mounted ?? null,
    maxSellableUnmounted: row.max_sellable_unmounted ?? null,
    sellableSizes: row.sellable_sizes ?? null,
    sizeOverrides: row.size_overrides ?? null,
    rawSourcePath: row.raw_source_path ?? null,
    rawWidth: row.raw_width ?? null,
    rawHeight: row.raw_height ?? null,
    rawMatchConfidence: row.raw_match_confidence ?? null,
    rawMatchNotes: row.raw_match_notes ?? null,
    sourceWidth: row.source_width ?? null,
    sourceHeight: row.source_height ?? null,
  };
}

type SeriesRow = {
  id: string;
  slug: string;
  name: string;
  period: string | null;
  subtitle: string | null;
  sort_order: number;
  is_visible: boolean;
};

function mapCollection(row: SeriesRow): Collection {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    period: row.period,
    subtitle: row.subtitle,
    sortOrder: row.sort_order,
    isVisible: row.is_visible,
  };
}

const NO_COLLECTIONS = { collections: [] as Collection[], membership: new Map<string, string[]>() };

// Collections (public.series) ship AHEAD of their migration, so every failure
// here degrades to "no collections" rather than taking the gallery down with
// it — before the SQL is applied the site renders exactly as it did before.
async function fetchCollections(): Promise<typeof NO_COLLECTIONS> {
  if (!supabase) return NO_COLLECTIONS;
  try {
    const [{ data: series, error: seriesError }, { data: links, error: linkError }] =
      await Promise.all([
        supabase
          .from("series")
          .select("id, slug, name, period, subtitle, sort_order, is_visible")
          .order("sort_order", { ascending: true }),
        supabase.from("photo_series").select("photo_id, series_id"),
      ]);
    if (seriesError || linkError) return NO_COLLECTIONS;

    const membership = new Map<string, string[]>();
    for (const link of (links ?? []) as { photo_id: string; series_id: string }[]) {
      const existing = membership.get(link.photo_id);
      if (existing) existing.push(link.series_id);
      else membership.set(link.photo_id, [link.series_id]);
    }
    return { collections: ((series ?? []) as SeriesRow[]).map(mapCollection), membership };
  } catch {
    return NO_COLLECTIONS;
  }
}

// Live sell prices from public.print_pricing (20260817010000_photo migration
// name aside — see 20260817010000_print_pricing.sql), admin-editable from
// the Pricing tab. Patches src/lib/printCatalogue.ts's SIZES in place on
// success; any failure (table not migrated yet, network blip) just leaves
// the fallback prices in SIZES untouched — same "ships ahead" posture as
// collections above, never blocks or breaks the gallery fetch.
async function fetchPricingSettings(): Promise<void> {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from("print_pricing").select("size, mounted, sell_cents");
    if (error || !data?.length) return;
    const pricing: Partial<Record<SizeId, { cfp?: number; cfpm?: number }>> = {};
    for (const row of data as { size: string; mounted: boolean; sell_cents: number }[]) {
      const id = row.size as SizeId;
      pricing[id] ??= {};
      if (row.mounted) pricing[id]!.cfpm = row.sell_cents / 100;
      else pricing[id]!.cfp = row.sell_cents / 100;
    }
    applyLivePricing(pricing);
  } catch {
    // fallback prices in SIZES stand.
  }
}

// The bundled fallback (dev / outage). Strip storage_path so the consumers fall
// back to the rows' own imageUrl instead of generating Supabase transform URLs
// for objects that don't exist (which would 404-storm the CDN on a phone).
function fallbackGallery() {
  return {
    locations: fallbackLocations,
    photos: fallbackPhotos.map((p) => ({ ...p, storagePath: undefined })),
    collections: [] as Collection[],
    source: "fallback" as const,
  };
}

export async function getGalleryData() {
  if (!supabase) return fallbackGallery();

  try {
    return await getGalleryDataInner();
  } catch (error) {
    // supabase-js REJECTS (not {error}) on a network/DNS/CORS failure — without
    // this the home page would hang permanently empty. Serve bundled data; the
    // focus/visibility refetch self-heals once the network returns.
    console.warn("Gallery fetch failed — using fallback data", error);
    return fallbackGallery();
  }
}

async function getGalleryDataInner() {
  if (!supabase) return fallbackGallery();

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
  let [{ data: locations, error: locationError }, { data: photos, error: photoError }, collectionData] =
    await Promise.all([
      supabase
        .from("locations")
        .select("id, slug, name, region, description, sort_order, map_feed_order")
        .eq("is_visible", true)
        .order("sort_order", { ascending: true }),
      // `ratio` and the max_sellable_*/sellable_sizes columns ship ahead of
      // their migration — retry without them until the columns exist
      // (otherwise the whole site would fall back to bundled data over
      // columns that don't exist yet).
      photoQuery(`ratio, max_sellable_mounted, max_sellable_unmounted, sellable_sizes, ${PUBLIC_PHOTO_COLUMNS}`),
      fetchCollections(),
      fetchPricingSettings(),
    ]);
  if (photoError) {
    ({ data: photos, error: photoError } = await photoQuery(PUBLIC_PHOTO_COLUMNS));
  }

  if (locationError || photoError) {
    console.warn("Using fallback gallery data", locationError ?? photoError);
    return fallbackGallery();
  }

  return {
    locations: (locations ?? []).map(mapLocation),
    photos: ((photos ?? []) as unknown as PhotoRow[]).map((row) => {
      const photo = mapPhoto(row);
      photo.collectionIds = collectionData.membership.get(row.id) ?? [];
      return photo;
    }),
    collections: collectionData.collections,
    source: "supabase" as const,
  };
}

const ADMIN_SELECT =
  "id, title, slug, description, location_id, kind, year_taken, captured_at, aspect, storage_bucket, storage_path, source_path, image_url, relative_altitude_m, latitude, longitude, is_map_feature, is_featured, is_published, sort_order, collection_order, in_shop, shop_order, created_at";
// Print-readiness columns ship ahead of their migrations (20260816010000,
// 20260816020000) — same "ships ahead" pattern as `ratio` in the public
// query. Requested separately so a stale DB (columns not applied yet)
// degrades to "no readiness data" instead of breaking the whole admin panel.
const ADMIN_PRINT_READINESS_SELECT =
  "max_sellable_mounted, max_sellable_unmounted, sellable_sizes, size_overrides, raw_source_path, raw_width, raw_height, raw_match_confidence, raw_match_notes, source_width, source_height";

export async function getAdminPhotos() {
  if (!supabase) return [];

  // Admin-only fetch: includes source_path + captured_at (NOT in the public
  // query — source_path is a private drive path). The RPC is SECURITY DEFINER
  // because authenticated users intentionally lack those column grants, but it
  // returns rows only when hardened is_admin() validates the caller. Anon has
  // no execute grant. Location names are joined client-side.
  //
  // IMPORTANT: don't chain .order() onto this RPC call. PostgREST mishandles
  // `select=` and `order=` combined against this specific setof-table RPC —
  // each works fine alone, but together they throw a bogus "column
  // photos.created_at does not exist" (confirmed against a real authenticated
  // session, 2026-08-16). The RPC returns every row in one call anyway (no
  // pagination to lose), so sort client-side below instead.
  let data: PhotoRow[] | null;
  let error: { message: string } | null;
  ({ data, error } = (await supabase
    .rpc("get_admin_photos")
    .select(`${ADMIN_SELECT}, ${ADMIN_PRINT_READINESS_SELECT}`)) as unknown as { data: PhotoRow[] | null; error: { message: string } | null });

  // Print-readiness columns ship ahead of their migration — retry without
  // them until the columns exist.
  if (error) {
    ({ data, error } = (await supabase
      .rpc("get_admin_photos")
      .select(ADMIN_SELECT)) as unknown as { data: PhotoRow[] | null; error: { message: string } | null });
  }
  if (error) throw error;
  data = (data ?? []).slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

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

// Best-effort removal of an orphaned storage object — e.g. an asset that
// uploaded successfully but whose DB row insert then failed. Never throws, so a
// cleanup failure can't mask the original error.
export async function removeUploadedAsset(storagePath: string) {
  if (!supabase || !storagePath) return;
  try {
    await supabase.storage.from(photoBucket).remove([storagePath]);
  } catch (error) {
    console.warn("Could not clean up orphaned upload", error);
  }
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

// Write a new running order for the places. Callers pass the full list in the
// order they want it; positions are renumbered in tens so there's always room
// to slot something between two neighbours later, and only the rows that
// actually moved are written.
export async function setLocationOrder(orderedLocationIds: string[]) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error: readError } = await supabase
    .from("locations")
    .select("id, sort_order");
  if (readError) throw readError;

  const current = new Map((data ?? []).map((row) => [row.id as string, row.sort_order as number]));
  const changed = orderedLocationIds
    .map((id, index) => ({ id, sortOrder: (index + 1) * 10 }))
    .filter((row) => current.get(row.id) !== row.sortOrder);

  for (const row of changed) {
    const { error } = await supabase
      .from("locations")
      .update({ sort_order: row.sortOrder })
      .eq("id", row.id);
    if (error) throw error;
  }
  return changed.length;
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

export async function updateLocationDetails(
  locationId: string,
  input: { name: string; region: string; description?: string | null },
) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const name = input.name.trim();
  const region = input.region.trim();
  if (!name) throw new Error("A location needs a name.");
  if (!region) throw new Error("A location needs a region.");

  // The slug intentionally stays unchanged when a display name is edited so
  // existing gallery URLs and external links do not break unexpectedly.
  const { data, error } = await supabase
    .from("locations")
    .update({ name, region, description: input.description?.trim() || null })
    .eq("id", locationId)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("The location was not updated.");
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

// `ratio` matters here as much as it does in the gallery: without it the Recent
// Work tiles — and the lightbox opened from them — can only guess a photo's
// shape from its aspect bucket, which is wrong by ~20% on a 16:9 frame.
const RECENT_SELECT =
  "id, title, slug, description, location_id, kind, year_taken, ratio, aspect, storage_bucket, storage_path, image_url, relative_altitude_m, latitude, longitude, is_map_feature, is_featured, is_published, sort_order, collection_order, in_shop, shop_order, max_sellable_mounted, max_sellable_unmounted, sellable_sizes, locations(id, slug, name, region, description, sort_order)";

// The "Recent Work" mosaic: admin-pinned photos (is_featured) sit in their
// chosen slot (sort_order 1..limit); any empty slots are filled with the most
// recent published photos.
export async function getRecentPhotos(limit = 5): Promise<Photo[]> {
  if (!supabase) return [];

  try {
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
  } catch (error) {
    console.warn("Recent photos fetch failed", error);
    return [];
  }
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

// Replace the complete ordered Recent Work selection in one admin action.
// Recent Work slots are the featured rows whose shared sort_order is 1..8;
// featured rows outside that range are left alone.
export async function setRecentWorkPicks(photoIds: string[]) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const uniqueIds = [...new Set(photoIds)].slice(0, 8);
  if (uniqueIds.length !== 8) throw new Error("Choose exactly 8 different photographs.");

  const { error: clearError } = await supabase
    .from("photos")
    .update({ is_featured: false })
    .eq("is_featured", true)
    .gte("sort_order", 1)
    .lte("sort_order", 8);
  if (clearError) throw clearError;

  for (const [index, photoId] of uniqueIds.entries()) {
    const { error } = await supabase
      .from("photos")
      .update({ is_featured: true, sort_order: index + 1 })
      .eq("id", photoId);
    if (error) throw error;
  }
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

  const { data, error } = await supabase
    .from("photos")
    .update(updates)
    .eq("id", photoId)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("The photo sale setting was not updated.");
}

// Set (or clear) one size/mount override on a photo, recompute the resolved
// sellable_sizes + max_sellable_mounted/unmounted from it, and save all
// three in one write — see supabase/migrations/20260816130000_photo_size_overrides.sql.
// `value` null clears the override (back to auto/computed) for that one cell.
export async function setPhotoSizeOverride(
  photo: Photo,
  size: SizeId,
  mounted: boolean,
  value: boolean | null,
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const width = photo.rawWidth || photo.sourceWidth || 0;
  const height = photo.rawHeight || photo.sourceHeight || 0;

  const nextOverrides: SizeOverrides = { ...(photo.sizeOverrides ?? {}) };
  const cell = { ...(nextOverrides[size] ?? {}) };
  if (value === null) delete cell[mounted ? "mounted" : "unmounted"];
  else cell[mounted ? "mounted" : "unmounted"] = value;
  if (Object.keys(cell).length) nextOverrides[size] = cell;
  else delete nextOverrides[size];

  const sellable = computeSellableSizes(width, height, nextOverrides);
  const updates = {
    size_overrides: Object.keys(nextOverrides).length ? nextOverrides : null,
    sellable_sizes: sellable,
    max_sellable_mounted: maxSellableFromSizes(sellable, true),
    max_sellable_unmounted: maxSellableFromSizes(sellable, false),
  };

  const { data, error } = await supabase
    .from("photos")
    .update(updates)
    .eq("id", photo.id)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("The size override was not saved.");
  return { sellableSizes: sellable, sizeOverrides: updates.size_overrides };
}

// ---------------------------------------------------------------------------
// Collections (public.series) — admin CRUD + membership.
// ---------------------------------------------------------------------------

// Admin view: every collection including hidden ones (RLS lets authenticated
// read them all). Returns [] when the migration hasn't been applied yet.
export async function getAdminCollections(): Promise<Collection[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("series")
      .select("id, slug, name, period, subtitle, sort_order, is_visible")
      .order("sort_order", { ascending: true });
    if (error) {
      console.warn("Could not read collections", error);
      return [];
    }
    return ((data ?? []) as SeriesRow[]).map(mapCollection);
  } catch (error) {
    console.warn("Collections fetch failed", error);
    return [];
  }
}

function slugifyCollection(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createCollection(input: {
  name: string;
  period?: string | null;
  subtitle?: string | null;
}): Promise<Collection> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const name = input.name.trim();
  if (!name) throw new Error("A collection needs a name.");

  // Slug comes from the display title so "2026 Europe" -> europe... no: keep the
  // period first, matching how the collection reads ("2026 Europe" -> 2026-europe).
  const base = slugifyCollection([input.period, name].filter(Boolean).join(" ")) || "collection";

  // Land it at the top of the rail — new trips are the ones worth showing first.
  const { data: existing } = await supabase.from("series").select("slug, sort_order");
  const taken = new Set((existing ?? []).map((row: { slug: string }) => row.slug));
  let slug = base;
  for (let i = 2; taken.has(slug); i += 1) slug = `${base}-${i}`;

  const { data, error } = await supabase
    .from("series")
    .insert({
      slug,
      name,
      period: input.period?.trim() || null,
      subtitle: input.subtitle?.trim() || null,
      sort_order: 0,
    })
    .select("id, slug, name, period, subtitle, sort_order, is_visible")
    .single();
  if (error) throw error;

  // Push everything else down one so the newcomer leads.
  for (const row of (existing ?? []) as { slug: string; sort_order: number }[]) {
    await supabase.from("series").update({ sort_order: row.sort_order + 1 }).eq("slug", row.slug);
  }
  return mapCollection(data as SeriesRow);
}

export async function updateCollection(
  id: string,
  input: {
    name?: string;
    period?: string | null;
    subtitle?: string | null;
    sortOrder?: number;
    isVisible?: boolean;
  },
) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const updates: Record<string, string | number | boolean | null> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("A collection needs a name.");
    updates.name = name;
  }
  if (input.period !== undefined) updates.period = input.period?.trim() || null;
  if (input.subtitle !== undefined) updates.subtitle = input.subtitle?.trim() || null;
  if (input.sortOrder !== undefined) updates.sort_order = input.sortOrder;
  if (input.isVisible !== undefined) updates.is_visible = input.isVisible;
  if (!Object.keys(updates).length) return;

  const { error } = await supabase.from("series").update(updates).eq("id", id);
  if (error) throw error;
}

// Deletes the collection itself; `on delete cascade` clears its membership rows.
// The photos are untouched.
export async function deleteCollection(id: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.from("series").delete().eq("id", id);
  if (error) throw error;
}

// Replace a collection's membership wholesale with `photoIds`, preserving the
// given order. Diffs against what's already there so re-saving an unchanged
// selection is a no-op rather than a delete-and-reinsert storm.
export async function setCollectionPhotos(collectionId: string, photoIds: string[]) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data: current, error: readError } = await supabase
    .from("photo_series")
    .select("photo_id")
    .eq("series_id", collectionId);
  if (readError) throw readError;

  const before = new Set((current ?? []).map((row: { photo_id: string }) => row.photo_id));
  const after = new Set(photoIds);

  const removed = [...before].filter((id) => !after.has(id));
  if (removed.length) {
    const { error } = await supabase
      .from("photo_series")
      .delete()
      .eq("series_id", collectionId)
      .in("photo_id", removed);
    if (error) throw error;
  }

  const rows = photoIds.map((photoId, index) => ({
    photo_id: photoId,
    series_id: collectionId,
    sort_order: index,
  }));
  if (rows.length) {
    const { error } = await supabase
      .from("photo_series")
      .upsert(rows, { onConflict: "photo_id,series_id" });
    if (error) throw error;
  }
}

// Every photo id currently in a collection (admin curation needs the full set,
// including unpublished drafts, which the public membership map omits).
export async function getCollectionMembership(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!supabase) return map;
  try {
    const { data, error } = await supabase.from("photo_series").select("photo_id, series_id");
    if (error) return map;
    for (const link of (data ?? []) as { photo_id: string; series_id: string }[]) {
      const existing = map.get(link.series_id);
      if (existing) existing.push(link.photo_id);
      else map.set(link.series_id, [link.photo_id]);
    }
    return map;
  } catch {
    return map;
  }
}

// ---------------------------------------------------------------------------
// Instagram feed (public.instagram_posts) — read-only for the site. Filled by
// the api/instagram-sync cron; the browser never talks to Instagram.
// ---------------------------------------------------------------------------
export async function getInstagramPosts(): Promise<InstagramPost[]> {
  // Bound once so the null-check narrows for the whole function (module-level
  // `supabase` loses its narrowing across an await).
  const client = supabase;
  if (!client) return [];
  try {
    const { data, error } = await client
      .from("instagram_posts")
      .select("id, caption, permalink, media_type, posted_at, storage_path, like_count, comments_count, sort_order")
      .order("sort_order", { ascending: true });
    // Ships ahead of its migration, so a missing table degrades to "no feed"
    // rather than taking the home page down.
    if (error) return [];
    return ((data ?? []) as InstagramRow[]).map((row) => ({
      id: row.id,
      caption: row.caption,
      permalink: row.permalink,
      mediaType: row.media_type,
      postedAt: row.posted_at,
      storagePath: row.storage_path,
      likeCount: row.like_count,
      commentsCount: row.comments_count,
      sortOrder: row.sort_order,
    }));
  } catch {
    return [];
  }
}

type InstagramRow = {
  id: string;
  caption: string | null;
  permalink: string;
  media_type: string | null;
  posted_at: string | null;
  storage_path: string | null;
  like_count: number | null;
  comments_count: number | null;
  sort_order: number;
};

// Read every site_settings row (visibility flags + small key/value settings).
// Public-safe: anon may read. Returns [] when Supabase isn't configured.
export async function getSiteSettings(): Promise<SiteSetting[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("site_settings")
      .select("key, enabled, value, label");
    if (error) {
      console.warn("Could not read site settings", error);
      return [];
    }
    return (data ?? []) as SiteSetting[];
  } catch (error) {
    console.warn("Site settings fetch failed", error);
    return [];
  }
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

export function realPrintPhotoUrl(photo: RealPrintPhoto, width = 1400) {
  return getTransformedPublicUrl(photoBucket, photo.storagePath, width, 80);
}

export async function getRealPrintPhotos(): Promise<RealPrintPhoto[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", "shop_real_print_gallery")
    .maybeSingle();
  if (error) throw error;
  if (!data?.value) return [];
  try {
    const parsed = JSON.parse(data.value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RealPrintPhoto => Boolean(
        item && typeof item === "object"
        && typeof (item as RealPrintPhoto).id === "string"
        && typeof (item as RealPrintPhoto).storagePath === "string"
        && typeof (item as RealPrintPhoto).altText === "string",
      ))
      .slice(0, 24)
      .map((item, index) => ({
        id: item.id,
        storagePath: item.storagePath,
        altText: item.altText,
        caption: typeof item.caption === "string" ? item.caption : null,
        sortOrder: index,
        published: item.published !== false,
      }));
  } catch {
    return [];
  }
}

async function saveRealPrintPhotos(photos: RealPrintPhoto[]) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const value = JSON.stringify(photos.slice(0, 24).map((photo, index) => ({ ...photo, sortOrder: index })));
  const { data: existing, error: readError } = await supabase
    .from("site_settings")
    .select("key")
    .eq("key", "shop_real_print_gallery")
    .maybeSingle();
  if (readError) throw readError;
  const query = existing
    ? supabase.from("site_settings").update({ value }).eq("key", "shop_real_print_gallery")
    : supabase.from("site_settings").insert({ key: "shop_real_print_gallery", enabled: false, value, label: "Shop — real print gallery" });
  const { error } = await query;
  if (error) throw error;
}

export async function uploadRealPrintAsset(file: Blob, originalName: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const extension = file.type === "image/webp" ? "webp" : originalName.split(".").pop()?.toLowerCase() ?? "jpg";
  const safeName = slugify(originalName.replace(/\.[^/.]+$/, "")) || "real-print";
  const token = Math.random().toString(36).slice(2, 8);
  const path = `real-prints/${Date.now()}-${token}-${safeName}.${extension}`;
  const { data, error } = await supabase.storage.from(photoBucket).upload(path, file, {
    cacheControl: "31536000",
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw error;
  return data.path;
}

export async function removeRealPrintAsset(storagePath: string) {
  if (!supabase || !storagePath) return;
  const { error } = await supabase.storage.from(photoBucket).remove([storagePath]);
  if (error) console.warn("Could not clean up real print asset", error);
}

export async function createRealPrintPhoto(input: { storagePath: string; altText: string; caption?: string; sortOrder: number }) {
  const current = await getRealPrintPhotos();
  if (current.length >= 24) throw new Error("The real print gallery supports up to 24 photographs.");
  const photo: RealPrintPhoto = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    storagePath: input.storagePath,
    altText: input.altText.trim(),
    caption: input.caption?.trim() || null,
    sortOrder: input.sortOrder,
    published: true,
  };
  await saveRealPrintPhotos([...current, photo]);
  return photo;
}

export async function updateRealPrintPhoto(id: string, patch: Partial<Pick<RealPrintPhoto, "altText" | "caption" | "sortOrder" | "published">>) {
  const current = await getRealPrintPhotos();
  await saveRealPrintPhotos(current.map((photo) => photo.id === id ? {
    ...photo,
    ...(patch.altText !== undefined ? { altText: patch.altText.trim() } : {}),
    ...(patch.caption !== undefined ? { caption: patch.caption?.trim() || null } : {}),
    ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    ...(patch.published !== undefined ? { published: patch.published } : {}),
  } : photo).sort((a, b) => a.sortOrder - b.sortOrder));
}

export async function reorderRealPrintPhotos(ids: string[]) {
  const current = await getRealPrintPhotos();
  const byId = new Map(current.map((photo) => [photo.id, photo]));
  await saveRealPrintPhotos(ids.map((id) => byId.get(id)).filter((photo): photo is RealPrintPhoto => Boolean(photo)));
}

export async function deleteRealPrintPhoto(photo: RealPrintPhoto) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const current = await getRealPrintPhotos();
  await saveRealPrintPhotos(current.filter((item) => item.id !== photo.id));
  const { error: storageError } = await supabase.storage.from(photoBucket).remove([photo.storagePath]);
  if (storageError) console.warn("Real print asset row was removed, but storage cleanup failed", storageError);
}
