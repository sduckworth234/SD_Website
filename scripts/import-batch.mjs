// One-shot importer for the approved 2021+ batch.
// Reads imports/import-approved.json ({ photos: [{ sourcePath, year, location }] }),
// ensures location rows exist, compresses + uploads each image to Storage, then
// inserts photo rows (title = location). Idempotent: storage upload upserts and
// inserts skip any storage_path already present, so it is safe to re-run.
//
// Env:
//   SUPABASE_SERVICE_ROLE_KEY  (required — bypasses RLS for the bulk write)
//   VITE_SUPABASE_URL, VITE_SUPABASE_PHOTO_BUCKET
//   PUBLISH=0   -> insert as drafts (default: published)
//   DRY_RUN=1   -> compress only, no upload / no DB writes
//   LIMIT=n     -> process only the first n photos (smoke test)
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { openSync, readSync, closeSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const approvedPath = process.argv[2] ?? "imports/import-approved.json";
const manifestOut = process.argv[3] ?? "imports/import-batch-manifest.json";
const compressedDir = "imports/compressed-batch";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const bucket = process.env.VITE_SUPABASE_PHOTO_BUCKET ?? "photos";
const publish = process.env.PUBLISH !== "0";
const dryRun = process.env.DRY_RUN === "1";
const limit = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;

if (!dryRun && (!supabaseUrl || !supabaseKey)) {
  throw new Error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

await mkdir(compressedDir, { recursive: true });
const supabase = dryRun ? null : createClient(supabaseUrl, supabaseKey);

let photos = JSON.parse(await readFile(approvedPath, "utf8")).photos;
if (Number.isFinite(limit)) photos = photos.slice(0, limit);

// --- 1. Ensure location rows exist (skip the "Unsorted" pseudo-bucket) -------
const locByName = new Map();
if (!dryRun) {
  const { data: existing, error } = await supabase
    .from("locations")
    .select("id, name, sort_order");
  if (error) throw error;
  existing.forEach((l) => locByName.set(l.name, l));

  let nextSort = existing.reduce((m, l) => Math.max(m, l.sort_order ?? 0), 0);
  const needed = [...new Set(photos.map((p) => p.location))].filter(
    (n) => n && n !== "Unsorted" && !locByName.has(n),
  );
  for (const name of needed) {
    nextSort += 1;
    const { data, error: insErr } = await supabase
      .from("locations")
      .insert({ name, slug: slugify(name), region: "Northern Beaches", sort_order: nextSort, is_visible: true })
      .select("id, name")
      .single();
    if (insErr) throw insErr;
    locByName.set(name, data);
    console.log(`+ location ${name}`);
  }
}

// --- 2. Existing storage paths (for idempotent inserts) ----------------------
const existingPaths = new Set();
if (!dryRun) {
  const { data, error } = await supabase.from("photos").select("storage_path");
  if (error) throw error;
  data.forEach((r) => r.storage_path && existingPaths.add(r.storage_path));
}

// --- 3. Compress + upload, collect rows --------------------------------------
const manifest = [];
const rows = [];
let skippedJunk = 0;
for (const [index, photo] of photos.entries()) {
  if (!isJpeg(photo.sourcePath)) {
    skippedJunk += 1;
    console.log(`skip (not jpeg) ${photo.sourcePath}`);
    continue;
  }
  const hash = createHash("sha1").update(photo.sourcePath).digest("hex").slice(0, 12);
  const locationSlug = slugify(photo.location) || "unsorted";
  const baseSlug = slugify(basename(photo.sourcePath).replace(/\.[^.]+$/, "")) || `photo-${index + 1}`;
  const storagePath = `approved/${photo.year ?? "unknown"}/${locationSlug}/${baseSlug}-${hash}.webp`;
  const localOutput = `${compressedDir}/${String(index + 1).padStart(4, "0")}-${hash}.webp`;

  const image = sharp(photo.sourcePath, { failOn: "none" }).rotate();
  const metadata = await image.metadata();
  // metadata reports pre-rotation dims — orientations 5-8 swap width/height.
  const sideways = (metadata.orientation ?? 1) >= 5;
  const outW = sideways ? metadata.height : metadata.width;
  const outH = sideways ? metadata.width : metadata.height;
  const aspect = inferAspect(outW, outH);
  const ratio = outW && outH ? Number((outW / outH).toFixed(4)) : null;
  await image
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78, effort: 5 })
    .toFile(localOutput);

  const year = photo.year ?? exifYear(photo.sourcePath);

  if (supabase) {
    const body = await readFile(localOutput);
    const { error } = await supabase.storage.from(bucket).upload(storagePath, body, {
      cacheControl: "31536000",
      contentType: "image/webp",
      upsert: true,
    });
    if (error) throw new Error(`Upload failed for ${photo.sourcePath}: ${error.message}`);
  }

  manifest.push({ sourcePath: photo.sourcePath, storagePath, location: photo.location, year, aspect });

  if (!existingPaths.has(storagePath)) {
    rows.push({
      title: photo.location,
      slug: `${locationSlug}-${hash}`,
      location_id: locByName.get(photo.location)?.id ?? null,
      kind: "Drone",
      year_taken: year ?? null,
      aspect,
      ratio,
      storage_bucket: bucket,
      storage_path: storagePath,
      is_featured: false,
      is_published: publish,
      sort_order: 200 + index,
    });
  }

  console.log(`${index + 1}/${photos.length} ${dryRun ? "compressed" : "uploaded"} ${storagePath}`);
}

await writeFile(manifestOut, JSON.stringify({ uploadedAt: null, count: manifest.length, uploaded: manifest }, null, 2));

// --- 4. Insert photo rows (chunked) ------------------------------------------
if (supabase && rows.length) {
  for (let i = 0; i < rows.length; i += 25) {
    const chunk = rows.slice(i, i + 25);
    const { error } = await supabase.from("photos").insert(chunk);
    if (error) throw error;
    console.log(`inserted ${Math.min(i + 25, rows.length)}/${rows.length}`);
  }
}

console.log(`\nDone. ${manifest.length} processed, ${skippedJunk} skipped, ${rows.length} new rows ${publish ? "(published)" : "(drafts)"}.`);
console.log(`Wrote ${manifestOut}`);

function isJpeg(path) {
  let fd;
  try { fd = openSync(path, "r"); } catch { return false; }
  try {
    const b = Buffer.alloc(3);
    readSync(fd, b, 0, 3, 0);
    return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  } catch { return false; } finally { closeSync(fd); }
}

function exifYear(sourcePath) {
  try {
    const r = spawnSync("mdls", ["-name", "kMDItemContentCreationDate", "-raw", sourcePath], { encoding: "utf8" });
    const m = (r.stdout || "").match(/(\d{4})-\d{2}-\d{2}/);
    if (m) { const y = Number(m[1]); if (y >= 2000 && y <= 2099) return y; }
  } catch { /* ignore */ }
  return null;
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
