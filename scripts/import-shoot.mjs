// One-pass photo importer: dump JPGs in a folder, run this once, photos land on
// the live gallery with every column populated. Replaces the old multi-step
// flow (geo-bucket -> geo-recountry -> import-folders -> altitude/coords
// backfill) for new batches: because WebP compression strips EXIF/XMP, this
// reads ALL metadata from the ORIGINAL JPG up front, geocodes it, THEN
// compresses + uploads + inserts a fully-populated row. No manifest round-trip.
//
// Per photo it derives: capture coords (EXIF GPS, then DJI-XMP fallback),
// drone height (DJI-XMP RelativeAltitude), year + capture date (EXIF), aspect
// (from the compressed output dims, so EXIF rotation is honoured), and a
// location/title from reverse geocoding (Nominatim). Location rows are created
// as needed. Idempotent: skips any storage_path already in `photos`, and the
// storage upload upserts — safe to re-run on the same folder.
//
// Usage: node --env-file=.env.local scripts/import-shoot.mjs "/path/to/dump"
//   DRY_RUN=1            plan only — read + geocode + compress, no upload / no DB
//   LOCATION="Manly"     force every photo into one location (skip geocoding the
//                        category; titles still come from each photo's GPS if any)
//   KIND="Drone"         force kind (Drone|Landscape|Travel); default: auto
//   REGION="Europe"      region for any NEW location rows; default: see below
//   PUBLISH=0            insert as drafts (default: published, live immediately)
//   LIMIT=n              process only the first n photos (smoke test)
//   SORT_BASE=500        sort_order base for new rows (appended after curated work)
//   DELAY_MS=1200        Nominatim rate-limit between distinct geocode calls
import { createHash } from "node:crypto";
import { openSync, readSync, closeSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import exifReader from "exif-reader";

// ---- config ----------------------------------------------------------------
const DIR = process.argv[2];
if (!DIR) throw new Error("Pass the source folder: node ... scripts/import-shoot.mjs \"/path/to/dump\"");

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const bucket = process.env.VITE_SUPABASE_PHOTO_BUCKET ?? "photos";

const dryRun = process.env.DRY_RUN === "1";
const publish = process.env.PUBLISH !== "0";
const forceLocation = process.env.LOCATION?.trim() || null;
const forceKind = process.env.KIND?.trim() || null;
const regionOverride = process.env.REGION?.trim() || null;
const limit = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const sortBase = process.env.SORT_BASE ? Number(process.env.SORT_BASE) : 500;
const DELAY_MS = Number(process.env.DELAY_MS ?? 1200);

const VALID_KINDS = new Set(["Drone", "Landscape", "Travel"]);
if (forceKind && !VALID_KINDS.has(forceKind)) throw new Error(`KIND must be one of ${[...VALID_KINDS].join(", ")}`);
if (!dryRun && (!supabaseUrl || !supabaseKey)) throw new Error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");

const folderTag = slugify(basename(DIR.replace(/\/+$/, ""))) || "shoot";
const compressedDir = process.env.COMPRESSED_DIR ?? `imports/compressed-${folderTag}`;
const manifestOut = process.env.MANIFEST ?? `imports/import-${folderTag}-manifest.json`;
await mkdir(compressedDir, { recursive: true });
const supabase = dryRun ? null : createClient(supabaseUrl, supabaseKey);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- gather JPGs (recursive; skip AppleDouble sidecars + dotfolders) --------
async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith("._") || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (/\.jpe?g$/i.test(e.name)) yield full;
  }
}
let files = [];
for await (const f of walk(DIR)) files.push(f);
files.sort();
if (Number.isFinite(limit)) files = files.slice(0, limit);
console.log(`${dryRun ? "[DRY] " : ""}Found ${files.length} JPG(s) under ${DIR}\n`);

// ---- EXIF / XMP / GPS / altitude helpers (the proven readers) ---------------
function isJpeg(path) {
  let fd;
  try { fd = openSync(path, "r"); } catch { return false; }
  try {
    const b = Buffer.alloc(3);
    readSync(fd, b, 0, 3, 0);
    return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  } catch { return false; } finally { closeSync(fd); }
}

// EXIF GPS arrives as [deg, min, sec] + an N/S/E/W ref.
function dms(arr, ref) {
  if (!Array.isArray(arr) || arr.length < 3) return null;
  let v = arr[0] + arr[1] / 60 + arr[2] / 3600;
  if (ref === "S" || ref === "W") v = -v;
  return Number.isFinite(v) ? v : null;
}

// DJI writes decimal-degree GPS + flight data into the XMP packet (an ASCII XML
// blob in an APP1 segment) which exif-reader doesn't parse — scan it raw.
function djiXmpNum(buf, field) {
  const s = buf.toString("latin1");
  const start = s.indexOf("<x:xmpmeta");
  const end = s.indexOf("</x:xmpmeta>");
  const xmp = start !== -1 && end !== -1 ? s.slice(start, end + 12) : s;
  const m =
    new RegExp(`drone-dji:${field}\\s*=\\s*"([^"]*)"`).exec(xmp) ||
    new RegExp(`<drone-dji:${field}>([^<]*)<`).exec(xmp);
  if (!m) return null;
  const n = Number.parseFloat(m[1].trim());
  return Number.isFinite(n) ? n : null;
}

const MIN_ALT = -200, MAX_ALT = 1000; // plausible "metres above takeoff" band
const round3 = (n) => Math.round(n * 1000) / 1000;

// Read everything we need from the original, in one go.
async function readSource(buf) {
  let exif = null;
  try {
    const meta = await sharp(buf).metadata();
    if (meta.exif) { try { exif = exifReader(meta.exif); } catch { /* unparseable */ } }
  } catch { /* not readable as image */ }

  // year + capture date
  let year = null, capturedAt = null;
  const dt = exif?.Photo?.DateTimeOriginal || exif?.Image?.DateTime;
  if (dt) {
    const d = new Date(dt);
    const y = d.getUTCFullYear();
    if (y >= 2000 && y <= 2099) {
      year = y;
      capturedAt = d.toISOString().slice(0, 10); // YYYY-MM-DD for captured_at
    }
  }

  // GPS — EXIF first, then DJI XMP
  let lat = null, lon = null, gpsSource = null;
  const g = exif?.GPSInfo;
  if (g?.GPSLatitude && g?.GPSLongitude) {
    const la = dms(g.GPSLatitude, g.GPSLatitudeRef);
    const lo = dms(g.GPSLongitude, g.GPSLongitudeRef);
    if (la != null && lo != null && (la !== 0 || lo !== 0)) { lat = la; lon = lo; gpsSource = "exif"; }
  }
  if (lat == null) {
    const la = djiXmpNum(buf, "GpsLatitude");
    const lo = djiXmpNum(buf, "GpsLongitude") ?? djiXmpNum(buf, "GpsLongtitude");
    if (la != null && lo != null && (la !== 0 || lo !== 0)) { lat = la; lon = lo; gpsSource = "xmp"; }
  }

  // drone height (DJI XMP only)
  let altitude = null;
  const rel = djiXmpNum(buf, "RelativeAltitude");
  if (rel != null && rel >= MIN_ALT && rel <= MAX_ALT) altitude = Math.round(rel * 100) / 100;
  const isDrone = djiXmpNum(buf, "RelativeAltitude") != null || /drone-dji:/.test(buf.toString("latin1").slice(0, 65536));

  return {
    year, capturedAt,
    lat: lat == null ? null : round3(lat),
    lon: lon == null ? null : round3(lon),
    gpsSource, altitude, isDrone,
  };
}

// ---- reverse geocoding (Nominatim, cached + rate-limited) -------------------
function tidy(s) { return String(s ?? "").replace(/[\/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim(); }

// Turn a Nominatim address into { country, isHome, category, title, region }.
// Convention: location (the gallery filter category) = country for overseas
// work, suburb/town for local; title = the precise place shown on the photo.
function placement(address) {
  const country = tidy(address.country);
  const isHome = /australia/i.test(country);
  const feature =
    address.attraction || address.tourism || address.leisure || address.natural ||
    address.beach || address.historic || address.neighbourhood || address.quarter || address.hamlet;
  const suburb = address.suburb || address.city_district || address.town || address.village || address.municipality;
  const locality = address.city || address.town || address.village || address.municipality;
  const region = address.state || address.county;

  let title;
  if (isHome) {
    title = feature || suburb || locality || country; // category already carries the suburb
  } else {
    title = feature && locality && feature !== locality ? `${feature}, ${locality}` : (feature || locality || region || country);
  }
  const category = isHome ? (suburb || locality || region || country) : (country || region || locality);
  return { country, isHome, category: tidy(category) || "Unsorted", title: tidy(title) || "Unsorted", region: tidy(region) };
}

const geoCache = new Map();
async function geocode(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`; // ~110m buckets
  if (geoCache.has(key)) return geoCache.get(key);
  await sleep(DELAY_MS);
  let result = { country: "", isHome: false, category: "Unsorted", title: "Unsorted", region: "" };
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=16&accept-language=en`;
    const res = await fetch(url, { headers: { "User-Agent": "sd-website-import-shoot/1.0" } });
    const data = await res.json();
    result = placement(data.address || {});
  } catch { /* leave Unsorted */ }
  geoCache.set(key, result);
  return result;
}

// ---- compress (read output dims so aspect honours EXIF rotation) ------------
function inferAspect(w = 0, h = 0) {
  if (!w || !h) return "landscape";
  const r = w / h;
  if (r > 1.85) return "wide";
  if (r < 0.8) return "portrait";
  if (r > 0.92 && r < 1.08) return "square";
  return "landscape";
}
async function compress(buf) {
  const { data, info } = await sharp(buf, { failOn: "none" })
    .rotate()
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78, effort: 5 })
    .toBuffer({ resolveWithObject: true });
  return { webp: data, aspect: inferAspect(info.width, info.height) };
}

function slugify(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ---- pre-load existing locations + storage paths (idempotency) --------------
const locByName = new Map();
const existingPaths = new Set();
if (supabase) {
  const [{ data: locs, error: le }, { data: paths, error: pe }] = await Promise.all([
    supabase.from("locations").select("id, name, sort_order"),
    supabase.from("photos").select("storage_path"),
  ]);
  if (le) throw le;
  if (pe) throw pe;
  locs.forEach((l) => locByName.set(l.name, l));
  paths.forEach((r) => r.storage_path && existingPaths.add(r.storage_path));
}
let nextLocSort = [...locByName.values()].reduce((m, l) => Math.max(m, l.sort_order ?? 0), 0);
const newLocations = new Set(); // names created (or that would be created) this run

async function ensureLocation(name, region) {
  if (!name) return null;
  const existing = locByName.get(name);
  if (existing) return existing.id; // null id only in dry run
  newLocations.add(name);
  if (!supabase) { locByName.set(name, { id: null, name }); return null; } // dry run
  nextLocSort += 1;
  const { data, error } = await supabase
    .from("locations")
    .insert({ name, slug: slugify(name), region: region || "Northern Beaches", sort_order: nextLocSort, is_visible: true })
    .select("id, name")
    .single();
  if (error) throw error;
  locByName.set(name, data);
  console.log(`+ location "${name}" (${region || "Northern Beaches"})`);
  return data.id;
}

// ---- process each photo: read -> geocode -> compress -> upload -> row -------
const rows = [];
const manifest = [];
const plan = [];   // for the dry-run summary
let idx = 0, skippedJunk = 0, skippedDupe = 0;

for (const src of files) {
  idx += 1;
  if (!isJpeg(src)) { skippedJunk += 1; console.log(`skip (not jpeg) ${src}`); continue; }

  const buf = await readFile(src);
  const meta = await readSource(buf);

  // decide location + title + the region for any new location row
  let location = forceLocation;
  let title = forceLocation;
  let isHome = true;
  let region = regionOverride || "Northern Beaches";
  if (meta.lat != null && meta.lon != null) {
    const geo = await geocode(meta.lat, meta.lon);
    isHome = geo.isHome;
    region = regionOverride || (geo.isHome ? "Northern Beaches" : (geo.region || geo.country || "Travel"));
    if (forceLocation) {
      title = geo.title && geo.title !== "Unsorted" ? geo.title : forceLocation;
    } else {
      location = geo.category;
      title = geo.title;
    }
  } else if (!forceLocation) {
    location = null; // no GPS + no override -> Unsorted draft for manual sorting
    title = basename(src).replace(/\.[^.]+$/, "");
  }

  const kind = forceKind || (meta.isDrone ? "Drone" : isHome ? "Landscape" : "Travel");

  const hash = createHash("sha1").update(src).digest("hex").slice(0, 12);
  const locSlug = slugify(location) || "unsorted";
  const baseSlug = slugify(basename(src).replace(/\.[^.]+$/, "")) || `photo-${idx}`;
  const storagePath = `approved/${meta.year ?? "unknown"}/${locSlug}/${baseSlug}-${hash}.webp`;

  const { webp, aspect } = await compress(buf);
  await writeFile(`${compressedDir}/${String(idx).padStart(4, "0")}-${hash}.webp`, webp);

  const entry = {
    n: idx, source: src, storagePath, location: location ?? "Unsorted", title,
    kind, year: meta.year, aspect, lat: meta.lat, lon: meta.lon,
    altitude: meta.altitude, gps: meta.gpsSource ?? "none",
  };
  plan.push(entry);
  manifest.push({ sourcePath: src, storagePath, location: location ?? "Unsorted", title, year: meta.year, aspect, latitude: meta.lat, longitude: meta.lon, relativeAltitude: meta.altitude });

  if (existingPaths.has(storagePath)) {
    skippedDupe += 1;
    console.log(`${idx}/${files.length}  = already imported  ${storagePath}`);
    continue;
  }

  const locationId = location ? await ensureLocation(location, region) : null;

  if (supabase) {
    const { error } = await supabase.storage.from(bucket).upload(storagePath, webp, {
      cacheControl: "31536000", contentType: "image/webp", upsert: true,
    });
    if (error) throw new Error(`Upload failed for ${src}: ${error.message}`);
  }

  rows.push({
    title: title || location || "Untitled",
    slug: `${locSlug}-${hash}`,
    location_id: locationId,
    kind,
    year_taken: meta.year ?? null,
    captured_at: meta.capturedAt ?? null,
    aspect,
    storage_bucket: bucket,
    storage_path: storagePath,
    relative_altitude_m: meta.altitude,
    latitude: meta.lat,
    longitude: meta.lon,
    is_featured: false,
    is_published: location ? publish : false, // no-location photos stay drafts
    sort_order: sortBase + idx,
  });

  const bits = [
    `${idx}/${files.length}`, dryRun ? "planned" : "uploaded",
    `[${location ?? "Unsorted"}]`, title,
    meta.year ? `${meta.year}` : "", aspect,
    meta.altitude != null ? `${Math.round(meta.altitude)}m` : "",
    meta.gpsSource ? `gps:${meta.gpsSource}` : "no-gps",
  ].filter(Boolean);
  console.log("  " + bits.join("  "));
}

// ---- write manifest + insert rows -------------------------------------------
await writeFile(manifestOut, JSON.stringify({ uploadedAt: null, source: DIR, count: manifest.length, uploaded: manifest }, null, 2));

if (supabase && rows.length) {
  for (let i = 0; i < rows.length; i += 25) {
    const chunk = rows.slice(i, i + 25);
    const { error } = await supabase.from("photos").insert(chunk);
    if (error) throw error;
    console.log(`inserted ${Math.min(i + 25, rows.length)}/${rows.length}`);
  }
}

// ---- summary ----------------------------------------------------------------
const byLoc = {};
for (const p of plan) { byLoc[p.location] = (byLoc[p.location] || 0) + 1; }
const noGps = plan.filter((p) => p.gps === "none").length;
const withAlt = plan.filter((p) => p.altitude != null).length;

console.log(`\n=== ${dryRun ? "PLAN (no changes made)" : "Done"} ===`);
console.log(`  photos:        ${plan.length} (${skippedJunk} non-jpeg skipped, ${skippedDupe} already imported)`);
console.log(`  new rows:      ${rows.length} ${publish ? "(published, live now)" : "(drafts)"}`);
console.log(`  no GPS:        ${noGps}${noGps && !forceLocation ? "  -> Unsorted drafts (sort in /admin or re-run with LOCATION=...)" : ""}`);
console.log(`  with altitude: ${withAlt}`);
console.log(`  locations:`);
for (const [name, n] of Object.entries(byLoc).sort((a, b) => b[1] - a[1])) {
  const isNew = newLocations.has(name);
  console.log(`    ${String(n).padStart(4)}  ${name}${isNew && name !== "Unsorted" ? "  (NEW)" : ""}`);
}
console.log(`\n  manifest: ${manifestOut}`);
if (dryRun) console.log(`\n  Re-run without DRY_RUN=1 to upload + publish.`);
