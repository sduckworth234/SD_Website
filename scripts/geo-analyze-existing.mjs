// READ-ONLY: for every already-uploaded (non-Europe) photo, map its Supabase
// storage_path back to the original source JPG via the upload manifests, read
// EXIF GPS, and reverse-geocode. Writes imports/geo-existing-analysis.json and
// prints summaries. No DB writes.
import sharp from "sharp";
import exifReader from "exif-reader";
import { readFile, writeFile } from "node:fs/promises";
import { openSync, readSync, closeSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DELAY_MS = Number(process.env.DELAY_MS ?? 1100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dms(arr, ref) {
  if (!Array.isArray(arr) || arr.length < 3) return null;
  let v = arr[0] + arr[1] / 60 + arr[2] / 3600;
  if (ref === "S" || ref === "W") v = -v;
  return v;
}
function tidy(s) { return String(s ?? "").replace(/[\/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim(); }

function placeName(a, fallback) {
  const feature = a.attraction || a.tourism || a.leisure || a.natural || a.beach || a.historic ||
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

async function readGps(src) {
  let fd;
  try { fd = openSync(src, "r"); } catch { return { missing: true }; }
  closeSync(fd);
  try {
    const m = await sharp(src).metadata();
    if (!m.exif) return {};
    const t = exifReader(m.exif);
    const g = t.GPSInfo || {};
    return { lat: dms(g.GPSLatitude, g.GPSLatitudeRef), lon: dms(g.GPSLongitude, g.GPSLongitudeRef) };
  } catch { return {}; }
}

const cache = new Map();
async function geocode(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);
  await sleep(DELAY_MS);
  let out = { precise: "Unsorted", suburb: "", city: "", country: "" };
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=16&accept-language=en`;
    const res = await fetch(url, { headers: { "User-Agent": "sd-website-geobucket/1.0" } });
    const a = (await res.json()).address || {};
    out = {
      precise: tidy(placeName(a)),
      suburb: tidy(a.suburb || a.neighbourhood || a.quarter || a.hamlet || a.attraction || a.natural || a.beach || ""),
      city: tidy(a.city || a.town || a.village || a.municipality || ""),
      country: tidy(a.country || ""),
    };
  } catch { /* leave default */ }
  cache.set(key, out);
  return out;
}

// Map storage_path -> sourcePath from the OLD (non-Europe) manifests.
const map = new Map();
for (const f of ["imports/uploaded-drone-manifest.json", "imports/import-batch-manifest.json"]) {
  try {
    const m = JSON.parse(await readFile(f, "utf8")).uploaded;
    for (const e of m) if (e.storagePath && e.sourcePath) map.set(e.storagePath, e.sourcePath);
  } catch { /* skip */ }
}

const { data: photos, error } = await sb.from("photos").select("id, title, storage_path, locations(name)");
if (error) throw error;
const targets = photos.filter((p) => p.storage_path && map.has(p.storage_path));

const results = [];
let gps = 0, nogps = 0, missing = 0, idx = 0;
for (const p of targets) {
  idx += 1;
  const src = map.get(p.storage_path);
  const r = await readGps(src);
  if (r.missing) { missing += 1; results.push({ id: p.id, current: p.locations?.name, title: p.title, src, status: "missing" }); }
  else if (r.lat == null) { nogps += 1; results.push({ id: p.id, current: p.locations?.name, title: p.title, src, status: "nogps" }); }
  else {
    const g = await geocode(r.lat, r.lon);
    gps += 1;
    results.push({ id: p.id, current: p.locations?.name, title: p.title, src, status: "ok", lat: r.lat, lon: r.lon, ...g });
  }
  if (idx % 25 === 0) console.log(`...${idx}/${targets.length}`);
}

await writeFile("imports/geo-existing-analysis.json", JSON.stringify(results, null, 2));

console.log(`\nTargets: ${targets.length}  | GPS ok: ${gps}  | no GPS: ${nogps}  | missing file: ${missing}`);

const okr = results.filter((r) => r.status === "ok");
const byCountry = {};
for (const r of okr) (byCountry[r.country || "?"] ||= new Set()).add(r.precise);
console.log("\n=== by country -> precise places ===");
for (const [c, set] of Object.entries(byCountry).sort()) {
  console.log(`\n${c} (${okr.filter((r) => r.country === c).length})`);
  for (const p of [...set].sort()) console.log(`  - ${p}  [${okr.filter((r) => r.country === c && r.precise === p).length}]`);
}
