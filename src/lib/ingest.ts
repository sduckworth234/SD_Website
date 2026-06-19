// Browser-side mirror of scripts/import-shoot.mjs: read everything we need
// from the ORIGINAL file first (compression strips EXIF/XMP), then compress to
// the site's standard WebP. Used by the admin upload panel so manually-added
// photos carry the same metadata as script imports — GPS, drone altitude,
// capture date, exact ratio — and never publish the full-res original.

// Keep in sync with scripts/import-shoot.mjs.
const MAX_EDGE = 2400;
const WEBP_QUALITY = 0.78;
const MIN_ALT = -200;
const MAX_ALT = 1000; // plausible "metres above takeoff" band

export type ExtractedPhotoMeta = {
  latitude: number | null;
  longitude: number | null;
  relativeAltitude: number | null; // DJI XMP; null for non-drone photos
  capturedAt: string | null; // YYYY-MM-DD
  year: number | null;
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function asNumber(value: unknown): number | null {
  // DJI XMP numbers often arrive as strings like "+24.30".
  const n = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function extractPhotoMetadata(file: File): Promise<ExtractedPhotoMeta> {
  const empty: ExtractedPhotoMeta = { latitude: null, longitude: null, relativeAltitude: null, capturedAt: null, year: null };
  try {
    // Lazy: exifr only ever loads in the admin upload flow, not the public bundle.
    const { default: exifr } = await import("exifr");
    const data = (await exifr.parse(file, { xmp: true })) as Record<string, unknown> | undefined;
    if (!data) return empty;

    const latitude = asNumber(data.latitude);
    const longitude = asNumber(data.longitude);

    // DJI flight height lives in the XMP packet (drone-dji:RelativeAltitude);
    // exifr merges XMP props into the flat output.
    const rel = asNumber(data.RelativeAltitude ?? data["drone-dji:RelativeAltitude"]);
    const relativeAltitude = rel != null && rel >= MIN_ALT && rel <= MAX_ALT ? Math.round(rel * 100) / 100 : null;

    let capturedAt: string | null = null;
    let year: number | null = null;
    const dt = data.DateTimeOriginal ?? data.CreateDate ?? data.ModifyDate;
    if (dt instanceof Date && !Number.isNaN(dt.getTime())) {
      const y = dt.getFullYear();
      if (y >= 2000 && y <= 2099) {
        year = y;
        const pad = (n: number) => String(n).padStart(2, "0");
        capturedAt = `${y}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      }
    }

    return {
      latitude: latitude != null && (latitude !== 0 || longitude !== 0) ? round3(latitude) : null,
      longitude: longitude != null && (latitude !== 0 || longitude !== 0) ? round3(longitude) : null,
      relativeAltitude,
      capturedAt,
      year,
    };
  } catch {
    // Unreadable metadata never blocks an upload.
    return empty;
  }
}

export type CompressedPhoto = {
  blob: Blob;
  width: number;
  height: number;
  ratio: number; // width / height, 4dp — drives stable gallery tiles
  aspect: "portrait" | "landscape" | "square" | "wide";
};

// Same thresholds as inferAspect in scripts/import-shoot.mjs.
function inferAspect(w: number, h: number): CompressedPhoto["aspect"] {
  if (!w || !h) return "landscape";
  const r = w / h;
  if (r > 1.85) return "wide";
  if (r < 0.8) return "portrait";
  if (r > 0.92 && r < 1.08) return "square";
  return "landscape";
}

function isHeic(file: File): boolean {
  return /image\/(heic|heif)/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

// Decode the original to a bitmap. iPhones shoot HEIC; most browsers (Chrome,
// Firefox, Android) can't decode it with createImageBitmap, so on failure we
// convert HEIC→JPEG with heic2any (lazy-loaded — a big wasm decoder that must
// never reach the public bundle) and decode that. iOS Safari usually hands us a
// JPEG already (the OS converts on pick), so this path mostly serves Android.
async function decodeToBitmap(file: File): Promise<ImageBitmap> {
  try {
    // from-image applies the EXIF orientation, so dimensions match what you see.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (error) {
    if (!isHeic(file)) throw error;
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    const jpeg = Array.isArray(converted) ? converted[0] : converted;
    return await createImageBitmap(jpeg, { imageOrientation: "from-image" });
  }
}

export async function compressToWebp(file: File): Promise<CompressedPhoto> {
  const bitmap = await decodeToBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the image for compression.");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
    if (!blob) throw new Error("Could not compress the image.");

    return {
      blob,
      width,
      height,
      ratio: Number((width / height).toFixed(4)),
      aspect: inferAspect(width, height),
    };
  } finally {
    bitmap.close();
  }
}
