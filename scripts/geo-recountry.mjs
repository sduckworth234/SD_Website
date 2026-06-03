// Re-nest precise-location folders under their country, giving a
// Country/PreciseName/ hierarchy. One geocode per precise folder (uses its
// first image's GPS) to determine the country.
//
// Usage: node scripts/geo-recountry.mjs ["/path/to/DroneDumpEurope"]
import sharp from "sharp";
import exifReader from "exif-reader";
import { readdir, mkdir, rename } from "node:fs/promises";
import { openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2] ?? "/Volumes/SamD2/2024/Drone/Europe/DroneDumpEurope";
const DELAY_MS = Number(process.env.DELAY_MS ?? 1200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isJpeg(path) {
  let fd;
  try { fd = openSync(path, "r"); } catch { return false; }
  try { const b = Buffer.alloc(3); readSync(fd, b, 0, 3, 0); return b[0]===0xff&&b[1]===0xd8&&b[2]===0xff; }
  catch { return false; } finally { closeSync(fd); }
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

async function gpsOf(file) {
  try {
    const m = await sharp(file).metadata();
    if (!m.exif) return {};
    const t = exifReader(m.exif);
    const g = t.GPSInfo || {};
    return { lat: dms(g.GPSLatitude, g.GPSLatitudeRef), lon: dms(g.GPSLongitude, g.GPSLongitudeRef) };
  } catch { return {}; }
}

async function countryOf(lat, lon) {
  await sleep(DELAY_MS);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=5&accept-language=en`;
    const res = await fetch(url, { headers: { "User-Agent": "sd-website-geobucket/1.0" } });
    const data = await res.json();
    return tidy(data.address?.country || "Europe") || "Europe";
  } catch { return "Europe"; }
}

const subs = (await readdir(DIR, { withFileTypes: true })).filter(
  (e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."),
);

const summary = {};
for (const s of subs) {
  const files = (await readdir(join(DIR, s.name))).filter((n) => !n.startsWith("._") && /\.jpe?g$/i.test(n));
  if (!files.length) continue;
  const first = join(DIR, s.name, files[0]);
  if (!isJpeg(first)) continue;
  const g = await gpsOf(first);
  const country = g.lat != null && g.lon != null ? await countryOf(g.lat, g.lon) : "Europe";
  await mkdir(join(DIR, country), { recursive: true });
  await rename(join(DIR, s.name), join(DIR, country, s.name));
  summary[country] = summary[country] || [];
  summary[country].push(`${s.name} (${files.length})`);
  console.log(`${s.name} (${files.length})  ->  ${country}/`);
}

console.log("\n=== Country / precise hierarchy ===");
for (const [country, places] of Object.entries(summary).sort()) {
  console.log(`\n${country}`);
  for (const p of places.sort()) console.log(`  - ${p}`);
}
