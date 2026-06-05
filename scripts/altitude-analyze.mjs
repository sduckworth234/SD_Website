// READ-ONLY: for every uploaded photo, map its Supabase storage_path back to the
// original source JPG via the upload manifests, and read the DJI drone flight
// height (drone-dji:RelativeAltitude, metres above takeoff) from the XMP packet.
// Compression to WebP strips EXIF/XMP, so this MUST read the originals.
// Writes imports/altitude-analysis.json. No DB writes.
//
// Usage: node --env-file=.env.local scripts/altitude-analyze.mjs   (sandbox off — reads /Volumes)
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const MANIFESTS = [
  "imports/uploaded-drone-manifest.json",
  "imports/import-batch-manifest.json",
  "imports/europe-manifest.json",
];

// drone-dji:RelativeAltitude lives in the XMP (an ASCII XML packet in an APP1
// segment). exif-reader doesn't parse XMP, so scan the raw buffer for it.
function pullDjiNum(buf, field) {
  const s = buf.toString("latin1");
  const start = s.indexOf("<x:xmpmeta");
  const end = s.indexOf("</x:xmpmeta>");
  const xmp = start !== -1 && end !== -1 ? s.slice(start, end + 12) : s;
  const attr = new RegExp(`drone-dji:${field}\\s*=\\s*"([^"]*)"`).exec(xmp);
  const elem = new RegExp(`<drone-dji:${field}>([^<]*)<`).exec(xmp);
  const m = attr || elem;
  if (!m) return null;
  const n = Number.parseFloat(m[1].trim());
  return Number.isFinite(n) ? n : null;
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

const results = [];
let ok = 0, noAlt = 0, missing = 0, idx = 0;
for (const p of targets) {
  idx += 1;
  const src = map.get(p.storage_path);
  let buf;
  try {
    buf = await readFile(src);
  } catch {
    missing += 1;
    results.push({ id: p.id, title: p.title, kind: p.kind, location: p.locations?.name, src, status: "missing" });
    continue;
  }
  const rel = pullDjiNum(buf, "RelativeAltitude");
  const abs = pullDjiNum(buf, "AbsoluteAltitude");
  if (rel == null) {
    noAlt += 1;
    results.push({ id: p.id, title: p.title, kind: p.kind, location: p.locations?.name, src, status: "no-altitude" });
  } else {
    ok += 1;
    results.push({
      id: p.id, title: p.title, kind: p.kind, location: p.locations?.name, src,
      status: "ok", relativeAltitude: rel, absoluteAltitude: abs,
    });
  }
  if (idx % 50 === 0) console.log(`...${idx}/${targets.length}`);
}

await writeFile("imports/altitude-analysis.json", JSON.stringify(results, null, 2));

console.log(`\n=== Altitude analysis ===`);
console.log(`  with RelativeAltitude : ${ok}`);
console.log(`  no altitude (likely non-drone) : ${noAlt}`);
console.log(`  source file missing   : ${missing}`);
console.log(`  unmapped (no manifest entry) : ${unmapped.length}`);

const withAlt = results.filter((r) => r.status === "ok").map((r) => r.relativeAltitude);
if (withAlt.length) {
  const sorted = [...withAlt].sort((a, b) => a - b);
  const round = (n) => Math.round(n);
  console.log(`\n  altitude range: ${round(sorted[0])}m – ${round(sorted[sorted.length - 1])}m`);
  console.log(`  median: ${round(sorted[Math.floor(sorted.length / 2)])}m`);
  console.log(`\n  highest 5 flights:`);
  for (const r of results.filter((r) => r.status === "ok").sort((a, b) => b.relativeAltitude - a.relativeAltitude).slice(0, 5)) {
    console.log(`    ${String(round(r.relativeAltitude)).padStart(4)}m  ${r.location ?? "?"} / ${r.title}`);
  }
}
console.log(`\nWrote imports/altitude-analysis.json`);
