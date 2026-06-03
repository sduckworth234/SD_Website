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

  const { data } = supabase.storage.from(bucket).getPublicUrl(path, {
    transform: {
      width,
      quality,
      resize: "cover",
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
  image_url: string | null;
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
    sortOrder: row.sort_order,
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
        .select("id, slug, name, region, description, sort_order")
        .eq("is_visible", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("photos")
        .select(
          "id, title, slug, description, location_id, kind, year_taken, aspect, storage_bucket, storage_path, image_url, is_featured, is_published, sort_order, locations(id, slug, name, region, description, sort_order)",
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

  const { data, error } = await supabase
    .from("photos")
    .select(
      "id, title, slug, description, location_id, kind, year_taken, aspect, storage_bucket, storage_path, image_url, is_featured, is_published, sort_order, locations(id, slug, name, region, description, sort_order)",
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

export async function updatePhotoDetails(
  photoId: string,
  input: {
    title: string;
    description?: string;
    locationId?: string;
    year?: number;
    aspect: Photo["aspect"];
  },
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const title = input.title.trim() || "Untitled";
  const { error } = await supabase
    .from("photos")
    .update({
      title,
      description: input.description?.trim() || null,
      location_id: input.locationId || null,
      year_taken: input.year || null,
      aspect: input.aspect,
      slug: `${slugify(title) || "untitled"}-${Date.now()}`,
    })
    .eq("id", photoId);

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
