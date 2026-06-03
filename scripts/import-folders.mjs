// Import location-bucketed folders into Supabase. Each immediate subfolder of
// DIR is treated as a location (skipping _NoGPS / dot folders): every JPG is
// compressed to WebP, uploaded to Storage, and inserted as a published photo
// with title = location, year from EXIF, aspect from dimensions. Location rows
// are created as needed (so the gallery picks up new categories). Idempotent:
// skips any storage_path already present, so re-runs don't duplicate.
//
// Usage: node --env-file=.env.local scripts/import-folders.mjs ["/path/to/dump"]
//        DRY_RUN=1  -> compress only, no upload / DB
//        LIMIT=n    -> first n photos (smoke test)
//        PUBLISH=0  -> insert as drafts
import { createHash } from "node:crypto";
import { openSync, readSync, closeSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import exifReader from "exif-reader";

const DIR = process.argv[2] ?? "/Volumes/SamD2/2024/Drone/Europe/DroneDumpEurope";
const compressedDir = process.env.COMPRESSED_DIR ?? "imports/compressed-europe";
const manifestOut = process.env.MANIFEST ?? "imports/europe-manifest.json";
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const bucket = process.env.VITE_SUPABASE_PHOTO_BUCKET ?? "photos";
const publish = process.env.PUBLISH !== "0";
const dryRun = process.env.DRY_RUN === "1";
const limit = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const region = process.env.REGION ?? "Europe";

if (!dryRun && (!supabaseUrl || !supabaseKey)) {
  throw new Error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

await mkdir(compressedDir, { recursive: true });
const supabase = dryRun ? null : createClient(supabaseUrl, supabaseKey);

// Each immediate subfolder is a location (skip _NoGPS, dotfiles).
const subdirs = (await readdir(DIR, { withFileTypes: true })).filter(
  (e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."),
);

let items = [];
for (const dir of subdirs) {
  const files = (await readdir(join(DIR, dir.name))).filter(
    (n) => !n.startsWith("._") && /\.jpe?g$/i.test(n),
  );
  for (const f of files) items.push({ path: join(DIR, dir.name, f), location: dir.name.trim() });
}
if (Number.isFinite(limit)) items = items.slice(0, limit);

console.log(`Found ${items.length} photos across ${subdirs.length} location folders.`);

// 1. Ensure location rows exist.
const locByName = new Map();
if (supabase) {
  const { data: existing, error } = await supabase.from("locations").select("id, name, sort_order");
  if (error) throw error;
  existing.forEach((l) => locByName.set(l.name, l));
  let nextSort = existing.reduce((m, l) => Math.max(m, l.sort_order ?? 0), 0);
  const needed = [...new Set(items.map((it) => it.location))].filter((n) => n && !locByName.has(n));
  for (const name of needed) {
    nextSort += 1;
    const { data, error: insErr } = await supabase
      .from("locations")
      .insert({ name, slug: slugify(name), region, sort_order: nextSort, is_visible: true })
      .select("id, name")
      .single();
    if (insErr) throw insErr;
    locByName.set(name, data);
    console.log(`+ location ${name}`);
  }
}

// 2. Existing storage paths (idempotent inserts).
const existingPaths = new Set();
if (supabase) {
  const { data, error } = await supabase.from("photos").select("storage_path");
  if (error) throw error;
  data.forEach((r) => r.storage_path && existingPaths.add(r.storage_path));
}

// 3. Compress + upload + collect rows.
const manifest = [];
const rows = [];
let idx = 0;
let skipped = 0;
for (const it of items) {
  idx += 1;
  if (!isJpeg(it.path)) { skipped += 1; console.log(`skip (not jpeg) ${it.path}`); continue; }

  const hash = createHash("sha1").update(it.path).digest("hex").slice(0, 12);
  const slugLoc = slugify(it.location) || "unsorted";
  const baseSlug = slugify(basename(it.path).replace(/\.[^.]+$/, "")) || `photo-${idx}`;

  const image = sharp(it.path, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  const aspect = inferAspect(meta.width, meta.height);
  const year = exifYear(meta);
  const storagePath = `approved/${year ?? "unknown"}/${slugLoc}/${baseSlug}-${hash}.webp`;
  const localOut = `${compressedDir}/${String(idx).padStart(4, "0")}-${hash}.webp`;

  await image
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78, effort: 5 })
    .toFile(localOut);

  if (supabase) {
    const body = await readFile(localOut);
    const { error } = await supabase.storage.from(bucket).upload(storagePath, body, {
      cacheControl: "31536000",
      contentType: "image/webp",
      upsert: true,
    });
    if (error) throw new Error(`Upload failed for ${it.path}: ${error.message}`);
  }

  manifest.push({ sourcePath: it.path, storagePath, location: it.location, year, aspect });

  if (!existingPaths.has(storagePath)) {
    rows.push({
      title: it.location,
      slug: `${slugLoc}-${hash}`,
      location_id: locByName.get(it.location)?.id ?? null,
      kind: "Drone",
      year_taken: year ?? null,
      aspect,
      storage_bucket: bucket,
      storage_path: storagePath,
      is_featured: false,
      is_published: publish,
      sort_order: 300 + idx,
    });
  }

  console.log(`${idx}/${items.length} ${dryRun ? "compressed" : "uploaded"} ${storagePath}`);
}

await writeFile(manifestOut, JSON.stringify({ uploadedAt: null, count: manifest.length, uploaded: manifest }, null, 2));

// 4. Insert rows (chunked).
if (supabase && rows.length) {
  for (let i = 0; i < rows.length; i += 25) {
    const chunk = rows.slice(i, i + 25);
    const { error } = await supabase.from("photos").insert(chunk);
    if (error) throw error;
    console.log(`inserted ${Math.min(i + 25, rows.length)}/${rows.length}`);
  }
}

console.log(`\nDone. ${manifest.length} processed, ${skipped} skipped, ${rows.length} new rows ${publish ? "(published)" : "(drafts)"}.`);
console.log(`Wrote ${manifestOut}`);

function exifYear(meta) {
  try {
    if (!meta.exif) return null;
    const tags = exifReader(meta.exif);
    const dt = tags.Photo?.DateTimeOriginal || tags.Image?.DateTime;
    if (!dt) return null;
    const y = new Date(dt).getUTCFullYear();
    return y >= 2000 && y <= 2099 ? y : null;
  } catch { return null; }
}

function isJpeg(path) {
  let fd;
  try { fd = openSync(path, "r"); } catch { return false; }
  try {
    const b = Buffer.alloc(3);
    readSync(fd, b, 0, 3, 0);
    return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  } catch { return false; } finally { closeSync(fd); }
}

function inferAspect(width = 0, height = 0) {
  if (!width || !height) return "landscape";
  const ratio = width / height;
  if (ratio > 1.85) return "wide";
  if (ratio < 0.8) return "portrait";
  if (ratio > 0.92 && ratio < 1.08) return "square";
  return "landscape";
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
