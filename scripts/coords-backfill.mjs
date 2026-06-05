// Apply capture coordinates to existing photos from imports/coords-analysis.json.
// Writes photos.latitude/longitude (already rounded to ~3dp by the analyze step)
// for every photo that had GPS. Photos without GPS stay null and fall back to their
// location's centroid on the map. No coordinates are fabricated here.
//
// Usage: DRY_RUN=1 node --env-file=.env.local scripts/coords-backfill.mjs
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const dryRun = process.env.DRY_RUN === "1";

const results = JSON.parse(await readFile("imports/coords-analysis.json", "utf8"));
const ok = results.filter(
  (r) => r.status === "ok" &&
    typeof r.lat === "number" && typeof r.lon === "number" &&
    r.lat >= -90 && r.lat <= 90 && r.lon >= -180 && r.lon <= 180,
);
const skipped = results.length - ok.length;

console.log(`Source rows: ${results.length} | to write: ${ok.length} | without coords (left null): ${skipped}`);

if (dryRun) {
  console.log("\n[DRY] no writes. Sample:");
  for (const r of ok.slice(0, 8)) console.log(`  ${r.lat}, ${r.lon}  ${r.location ?? "?"} / ${r.title}`);
  process.exit(0);
}

let done = 0;
for (const r of ok) {
  const { error } = await sb
    .from("photos")
    .update({ latitude: r.lat, longitude: r.lon })
    .eq("id", r.id);
  if (error) throw error;
  done += 1;
  if (done % 50 === 0) console.log(`...${done}/${ok.length}`);
}
console.log(`\nUpdated ${done} photos with latitude/longitude.`);
