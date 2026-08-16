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
// Also derives print-shop readiness (added 2026-08-16, alongside the
// drive-wide raw/print-master audit — see imports/DELETE/raw-source-audit-scratch
// for that one-off run's working notes): source_width/source_height from the
// decoded source JPG, and max_sellable_mounted/max_sellable_unmounted (the
// largest print size this photo clears the 200dpi floor for — see
// server/shop/printSizing.mjs) from the best available dimensions (a matched
// RAW_DIR raw, when given, else the source JPG itself). `in_shop` is still a
// manual curation decision, same as always — this just tells you upfront, in
// the import log, what size a newly imported photo could honestly be sold at.
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
//   RAW_DIR="/path/to/Photos Original"   optional sibling folder of untouched
//                        camera originals (DNG/RAW/TIFF/JPG) for this same
//                        shoot — if given, each imported photo is matched to
//                        a file in here by exact-second EXIF capture time
//                        (same technique as the 2026-08-16 drive-wide raw
//                        audit) and raw_source_path/raw_width/raw_height are
//                        set from it. Optional because plenty of shoots
//                        genuinely have no separate raw folder.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { openSync, readSync, closeSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import exifReader from "exif-reader";
import exifr from "exifr";
import { maxSellableSize } from "../server/shop/printSizing.mjs";

const execFileAsync = promisify(execFile);

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
const rawDir = process.env.RAW_DIR?.trim() || null;

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
  let exif = null, sourceWidth = null, sourceHeight = null;
  try {
    const meta = await sharp(buf).metadata();
    sourceWidth = meta.width ?? null;
    sourceHeight = meta.height ?? null;
    if (meta.exif) { try { exif = exifReader(meta.exif); } catch { /* unparseable */ } }
  } catch { /* not readable as image */ }

  // year + capture date
  let year = null, capturedAt = null, captureLocalNaive = null;
  const dt = exif?.Photo?.DateTimeOriginal || exif?.Image?.DateTime;
  if (dt) {
    const d = new Date(dt);
    const y = d.getUTCFullYear();
    if (y >= 2000 && y <= 2099) {
      year = y;
      capturedAt = d.toISOString().slice(0, 10); // YYYY-MM-DD for captured_at
    }
    // Local-naive wall-clock string (LOCAL getters, not UTC) for matching
    // against a RAW_DIR candidate's own EXIF timestamp — same convention as
    // the 2026-08-16 drive-wide raw audit. Round-trips correctly regardless
    // of the machine's timezone since both sides use the same getters.
    const p = (n) => String(n).padStart(2, "0");
    captureLocalNaive = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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
    year, capturedAt, captureLocalNaive,
    sourceWidth, sourceHeight,
    lat: lat == null ? null : round3(lat),
    lon: lon == null ? null : round3(lon),
    gpsSource, altitude, isDrone,
  };
}

// ---- optional raw-folder matching (RAW_DIR) ---------------------------------
// Same technique as the 2026-08-16 drive-wide raw audit: index every raw
// candidate's EXIF capture time once, then match each imported photo to it by
// exact-second timestamp. Built lazily so a normal import (no RAW_DIR) pays
// nothing for it.
const RAW_EXTS = /\.(dng|raw|nef|cr2|cr3|arw|tif|tiff|jpe?g)$/i;
let rawIndexPromise = null;
async function rawIndex() {
  if (!rawDir) return new Map();
  if (!rawIndexPromise) {
    rawIndexPromise = (async () => {
      const map = new Map(); // localNaive -> [{path}]
      const entries = [];
      for await (const f of walk(rawDir)) if (RAW_EXTS.test(f)) entries.push(f);
      console.log(`RAW_DIR: indexing ${entries.length} candidate(s) in ${rawDir}…`);
      for (const path of entries) {
        try {
          const exif = await exifr.parse(path, { pick: ["DateTimeOriginal"] });
          if (!exif?.DateTimeOriginal) continue;
          const d = exif.DateTimeOriginal;
          const p = (n) => String(n).padStart(2, "0");
          const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(path);
        } catch { /* unreadable — skip */ }
      }
      return map;
    })();
  }
  return rawIndexPromise;
}

async function sipsDims(path) {
  try {
    const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
    const w = /pixelWidth: (\d+)/.exec(stdout);
    const h = /pixelHeight: (\d+)/.exec(stdout);
    return w && h ? { width: Number.parseInt(w[1], 10), height: Number.parseInt(h[1], 10) } : null;
  } catch {
    return null;
  }
}

async function matchRaw(captureLocalNaive) {
  if (!rawDir || !captureLocalNaive) return null;
  const index = await rawIndex();
  const candidates = index.get(captureLocalNaive);
  if (!candidates || candidates.length !== 1) return null; // no match, or ambiguous — leave for manual review
  const dims = await sipsDims(candidates[0]);
  if (!dims) return null;
  return { path: candidates[0], width: dims.width, height: dims.height };
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
  return {
    webp: data,
    aspect: inferAspect(info.width, info.height),
    // Exact proportion — reserves the gallery tile's true shape pre-load.
    ratio: info.width && info.height ? Number((info.width / info.height).toFixed(4)) : null,
  };
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
  // Destination folder: MMYYYY_Location (capture month+year, then the place,
  // spaces/punctuation stripped, original case kept), e.g. 062021_Warriewood.
  const mm = meta.capturedAt ? meta.capturedAt.slice(5, 7) : "00";
  const yyyy = meta.capturedAt ? meta.capturedAt.slice(0, 4) : String(meta.year ?? "0000");
  const locTag = (location ?? "Unsorted").replace(/[^A-Za-z0-9]+/g, "") || "Unsorted";
  const storagePath = `${mm}${yyyy}_${locTag}/${baseSlug}-${hash}.webp`;

  const { webp, aspect, ratio } = await compress(buf);
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

  const raw = await matchRaw(meta.captureLocalNaive);
  const effWidth = raw?.width || meta.sourceWidth;
  const effHeight = raw?.height || meta.sourceHeight;
  const maxMounted = maxSellableSize(effWidth, effHeight, true);
  const maxUnmounted = maxSellableSize(effWidth, effHeight, false);

  rows.push({
    title: title || location || "Untitled",
    slug: `${locSlug}-${hash}`,
    location_id: locationId,
    kind,
    year_taken: meta.year ?? null,
    captured_at: meta.capturedAt ?? null,
    aspect,
    ratio,
    storage_bucket: bucket,
    storage_path: storagePath,
    source_path: src, // link back to the original full-res file
    source_width: meta.sourceWidth,
    source_height: meta.sourceHeight,
    raw_source_path: raw?.path ?? null,
    raw_width: raw?.width ?? null,
    raw_height: raw?.height ?? null,
    raw_match_confidence: raw ? "exact_timestamp" : (rawDir ? "none" : null),
    raw_match_notes: raw ? `Matched against RAW_DIR at import time.` : (rawDir ? "No unique exact-timestamp match found in RAW_DIR at import time." : null),
    max_sellable_mounted: maxMounted,
    max_sellable_unmounted: maxUnmounted,
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
    maxMounted ? `sellable-to:${maxMounted}` : "too-small-to-sell",
    raw ? "raw-matched" : "",
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

  // Warm the transform CDN for the new photos (the gallery's srcset widths —
  // keep in sync with SRCSET_WIDTHS in src/App.tsx) so their first viewers
  // get cache HITs instead of cold per-variant generation.
  const WARM_WIDTHS = [400, 700, 1000, 1400, 1800];
  console.log(`\nwarming ${rows.length * WARM_WIDTHS.length} CDN variants…`);
  let warmed = 0;
  for (const row of rows) {
    await Promise.all(WARM_WIDTHS.map(async (width) => {
      try {
        const { data } = supabase.storage
          .from(bucket)
          .getPublicUrl(row.storage_path, { transform: { width, quality: width >= 1800 ? 76 : 72, resize: "contain" } });
        const res = await fetch(data.publicUrl);
        await res.arrayBuffer();
        warmed += 1;
      } catch { /* warming only — never fail the import */ }
    }));
  }
  console.log(`warmed ${warmed} variants`);
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
if (rawDir) {
  const rawMatched = rows.filter((r) => r.raw_source_path).length;
  console.log(`  raw matched:   ${rawMatched}/${rows.length} against RAW_DIR`);
}
const sellCounts = {};
for (const r of rows) sellCounts[r.max_sellable_mounted ?? "none"] = (sellCounts[r.max_sellable_mounted ?? "none"] || 0) + 1;
console.log(`  max sellable size (mounted): ${Object.entries(sellCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`);
console.log(`  locations:`);
for (const [name, n] of Object.entries(byLoc).sort((a, b) => b[1] - a[1])) {
  const isNew = newLocations.has(name);
  console.log(`    ${String(n).padStart(4)}  ${name}${isNew && name !== "Unsorted" ? "  (NEW)" : ""}`);
}
console.log(`\n  manifest: ${manifestOut}`);
if (dryRun) console.log(`\n  Re-run without DRY_RUN=1 to upload + publish.`);
