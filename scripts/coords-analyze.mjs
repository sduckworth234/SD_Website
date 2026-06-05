// READ-ONLY: for every uploaded photo, map its Supabase storage_path back to the
// original source JPG via the upload manifests and read its capture coordinates.
// Tries standard EXIF GPS first, then falls back to the DJI XMP GpsLatitude/
// GpsLongitude (the older FC3411 drone writes GPS only in XMP). WebP compression
// strips both, so this MUST read the originals.
// Writes imports/coords-analysis.json. No DB writes.
//
// Usage: node --env-file=.env.local scripts/coords-analyze.mjs   (sandbox off — reads /Volumes)
import sharp from "sharp";
import exifReader from "exif-reader";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const MANIFESTS = [
  "imports/uploaded-drone-manifest.json",
  "imports/import-batch-manifest.json",
  "imports/europe-manifest.json",
];

// EXIF GPS arrives as [deg, min, sec] + a N/S/E/W ref.
function dms(arr, ref) {
  if (!Array.isArray(arr) || arr.length < 3) return null;
  let v = arr[0] + arr[1] / 60 + arr[2] / 3600;
  if (ref === "S" || ref === "W") v = -v;
  return Number.isFinite(v) ? v : null;
}

// DJI XMP stores decimal-degree GPS directly, e.g. drone-dji:GpsLatitude="-33.6550158".
function xmpNum(s, field) {
  const attr = new RegExp(`drone-dji:${field}\\s*=\\s*"([^"]*)"`).exec(s);
  const elem = new RegExp(`<drone-dji:${field}>([^<]*)<`).exec(s);
  const m = attr || elem;
  if (!m) return null;
  const n = Number.parseFloat(m[1].trim());
  return Number.isFinite(n) ? n : null;
}

async function readCoords(buf) {
  // 1) standard EXIF GPS
  try {
    const meta = await sharp(buf).metadata();
    if (meta.exif) {
      const t = exifReader(meta.exif);
      const g = t.GPSInfo || t.gps;
      if (g && g.GPSLatitude && g.GPSLongitude) {
        const lat = dms(g.GPSLatitude, g.GPSLatitudeRef);
        const lon = dms(g.GPSLongitude, g.GPSLongitudeRef);
        if (lat != null && lon != null && (lat !== 0 || lon !== 0)) {
          return { lat, lon, source: "exif" };
        }
      }
    }
  } catch { /* fall through to XMP */ }
  // 2) DJI XMP fallback
  const s = buf.toString("latin1");
  const start = s.indexOf("<x:xmpmeta");
  const end = s.indexOf("</x:xmpmeta>");
  const xmp = start !== -1 && end !== -1 ? s.slice(start, end + 12) : s;
  const lat = xmpNum(xmp, "GpsLatitude");
  const lon = xmpNum(xmp, "GpsLongitude") ?? xmpNum(xmp, "GpsLongtitude");
  if (lat != null && lon != null && (lat !== 0 || lon !== 0)) {
    return { lat, lon, source: "xmp" };
  }
  return null;
}

// Build storage_path -> sourcePath from every manifest.
const map = new Map();
for (const f of MANIFESTS) {
  try {
    const j = JSON.parse(await readFile(f, "utf8"));
    for (const e of j.uploaded || j) {
      if (e.storagePath && e.sourcePath) map.set(e.storagePath, e.sourcePath);
    }
  } catch (err) {
    console.warn(`(skip manifest ${f}: ${err.message})`);
  }
}
console.log(`Manifest map: ${map.size} storage_path -> sourcePath entries`);

const { data: photos, error } = await sb
  .from("photos")
  .select("id, title, kind, storage_path, locations(name)");
if (error) throw error;

const targets = photos.filter((p) => p.storage_path && map.has(p.storage_path));
const unmapped = photos.filter((p) => p.storage_path && !map.has(p.storage_path));
console.log(`Photos: ${photos.length} | mappable to a source JPG: ${targets.length} | unmapped: ${unmapped.length}`);

const round3 = (n) => Math.round(n * 1000) / 1000;
const results = [];
let exif = 0, xmp = 0, nogps = 0, missing = 0, idx = 0;
for (const p of targets) {
  idx += 1;
  const src = map.get(p.storage_path);
  let buf;
  try {
    buf = await readFile(src);
  } catch {
    missing += 1;
    results.push({ id: p.id, title: p.title, location: p.locations?.name, src, status: "missing" });
    continue;
  }
  const c = await readCoords(buf);
  if (!c) {
    nogps += 1;
    results.push({ id: p.id, title: p.title, location: p.locations?.name, src, status: "nogps" });
  } else {
    if (c.source === "exif") exif += 1; else xmp += 1;
    results.push({
      id: p.id, title: p.title, location: p.locations?.name, src,
      status: "ok", lat: round3(c.lat), lon: round3(c.lon), source: c.source,
    });
  }
  if (idx % 50 === 0) console.log(`...${idx}/${targets.length}`);
}

await writeFile("imports/coords-analysis.json", JSON.stringify(results, null, 2));

console.log(`\n=== Coordinate analysis ===`);
console.log(`  with GPS (EXIF): ${exif}`);
console.log(`  with GPS (DJI XMP fallback): ${xmp}`);
console.log(`  total with coords: ${exif + xmp}`);
console.log(`  no GPS: ${nogps}`);
console.log(`  source file missing: ${missing}`);
console.log(`  unmapped (no manifest entry): ${unmapped.length}`);

// Per-location coverage: which locations have at least one pin vs none.
const ok = results.filter((r) => r.status === "ok");
const byLoc = {};
for (const r of results) {
  const k = r.location || "Unsorted";
  byLoc[k] ||= { total: 0, withGps: 0 };
  byLoc[k].total += 1;
  if (r.status === "ok") byLoc[k].withGps += 1;
}
const locsNoGps = Object.entries(byLoc).filter(([, v]) => v.withGps === 0).map(([k]) => k);
console.log(`\n  locations: ${Object.keys(byLoc).length} | with at least one pin: ${Object.keys(byLoc).length - locsNoGps.length}`);
if (locsNoGps.length) console.log(`  locations with NO GPS at all (will need a fallback): ${locsNoGps.join(", ")}`);

// Rough sanity: lat/lon bounds
const bad = ok.filter((r) => r.lat < -90 || r.lat > 90 || r.lon < -180 || r.lon > 180);
if (bad.length) console.log(`\n  WARNING: ${bad.length} out-of-range coords`);
console.log(`\nWrote imports/coords-analysis.json`);
