// Bucket a flat dump of drone JPGs into Location-named folders using EXIF GPS
// + reverse geocoding (OpenStreetMap Nominatim). Files with no GPS go to
// _NoGPS for manual sorting. Geocode results are cached and rate-limited.
//
// Usage:  node scripts/geo-bucket.mjs ["/path/to/dump"]
//         DRY=1 node scripts/geo-bucket.mjs ...   (log only, no moves)
import sharp from "sharp";
import exifReader from "exif-reader";
import { readdir, mkdir, rename } from "node:fs/promises";
import { openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2] ?? "/Volumes/SamD2/2024/Drone/Europe/DroneDumpEurope";
const DRY = process.env.DRY === "1";
const DELAY_MS = Number(process.env.DELAY_MS ?? 1200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isJpeg(path) {
  let fd;
  try { fd = openSync(path, "r"); } catch { return false; }
  try {
    const b = Buffer.alloc(3);
    readSync(fd, b, 0, 3, 0);
    return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  } catch { return false; } finally { closeSync(fd); }
}

function dms(arr, ref) {
  if (!Array.isArray(arr) || arr.length < 3) return null;
  let v = arr[0] + arr[1] / 60 + arr[2] / 3600;
  if (ref === "S" || ref === "W") v = -v;
  return v;
}

function tidy(s) {
  return String(s).replace(/[\/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
}

async function readMeta(file) {
  try {
    const m = await sharp(file).metadata();
    if (!m.exif) return {};
    let tags;
    try { tags = exifReader(m.exif); } catch { return {}; }
    const g = tags.GPSInfo || {};
    const dt = tags.Photo?.DateTimeOriginal || tags.Image?.DateTime || null;
    return {
      lat: dms(g.GPSLatitude, g.GPSLatitudeRef),
      lon: dms(g.GPSLongitude, g.GPSLongitudeRef),
      year: dt ? new Date(dt).getUTCFullYear() : null,
    };
  } catch { return {}; }
}

// Build a descriptive place name: prefer a named feature (landmark / beach /
// suburb) combined with its city — e.g. "Banje Beach, Dubrovnik" or
// "Grad, Dubrovnik" — falling back to city, then region/country.
function placeName(a, fallback) {
  const feature =
    a.attraction || a.tourism || a.leisure || a.natural || a.beach || a.historic ||
    a.neighbourhood || a.suburb || a.quarter || a.hamlet;
  const locality = a.city || a.town || a.village || a.municipality;
  const region = a.county || a.state;
  const country = a.country;

  if (feature && locality && feature !== locality) return `${feature}, ${locality}`;
  if (feature) return feature !== country && country ? `${feature}, ${country}` : feature;
  if (locality) return locality;
  if (region) return country ? `${region}, ${country}` : region;
  return country || fallback || "Unsorted";
}

const cache = new Map();
async function geocode(lat, lon) {
  // ~110m buckets so distinct areas (a beach vs the old town) can split, while
  // co-located drone frames still share one geocode call.
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);
  await sleep(DELAY_MS);
  let name = "Unsorted";
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=16&accept-language=en`;
    const res = await fetch(url, { headers: { "User-Agent": "sd-website-geobucket/1.0" } });
    const data = await res.json();
    name = placeName(data.address || {}, data.name);
  } catch { /* leave Unsorted */ }
  const result = tidy(name) || "Unsorted";
  cache.set(key, result);
  return result;
}

const entries = (await readdir(DIR, { withFileTypes: true })).filter(
  (e) => e.isFile() && !e.name.startsWith("._") && /\.jpe?g$/i.test(e.name),
);

console.log(`${DRY ? "[DRY] " : ""}Found ${entries.length} JPGs in ${DIR}\n`);
const counts = {};
let i = 0;

for (const e of entries) {
  i += 1;
  const src = join(DIR, e.name);
  if (!isJpeg(src)) continue;
  const meta = await readMeta(src);
  const folder =
    meta.lat == null || meta.lon == null ? "_NoGPS" : await geocode(meta.lat, meta.lon);

  if (!DRY) {
    const destDir = join(DIR, folder);
    await mkdir(destDir, { recursive: true });
    await rename(src, join(destDir, e.name));
    try { await rename(join(DIR, "._" + e.name), join(destDir, "._" + e.name)); } catch { /* no sidecar */ }
  }

  counts[folder] = (counts[folder] || 0) + 1;
  console.log(`${i}/${entries.length}  ${e.name}  ->  ${folder}${meta.year ? `  (${meta.year})` : ""}`);
}

console.log("\n=== Buckets ===");
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}
console.log(
  `\n${DRY ? "[DRY] no files moved. " : ""}Review the folders, rename any if needed, then run import-folders.mjs.`,
);
