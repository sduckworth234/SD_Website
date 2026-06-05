// Apply drone flight heights to existing photos from imports/altitude-analysis.json.
// Sets photos.relative_altitude_m faithfully from the source files. A single
// physically-impossible sensor fault (|v| out of plausible bounds) is dropped to
// null rather than written. Presentation rules (hiding negatives / ~0m heights
// from the badge) live in the gallery UI, not here.
//
// Usage: DRY_RUN=1 node --env-file=.env.local scripts/altitude-backfill.mjs
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const dryRun = process.env.DRY_RUN === "1";

// Plausible band for a "metres above takeoff" reading. Consumer drones can reach
// a few hundred metres; anything beyond this is a barometric fault (e.g. the lone
// +6549.9m North Head reading whose AbsoluteAltitude was +1.2m).
const MAX_PLAUSIBLE = 1000;
const MIN_PLAUSIBLE = -200;

const results = JSON.parse(await readFile("imports/altitude-analysis.json", "utf8"));
const ok = results.filter((r) => r.status === "ok" && typeof r.relativeAltitude === "number");

const updates = [];
const dropped = [];
for (const r of ok) {
  const v = r.relativeAltitude;
  if (v > MAX_PLAUSIBLE || v < MIN_PLAUSIBLE) {
    dropped.push(r);
    continue;
  }
  // store at cm precision; the UI rounds to whole metres
  updates.push({ id: r.id, value: Math.round(v * 100) / 100, title: r.title, location: r.location });
}

console.log(`Source rows with altitude: ${ok.length}`);
console.log(`To write: ${updates.length} | dropped as implausible: ${dropped.length}`);
for (const d of dropped) console.log(`  dropped ${Math.round(d.relativeAltitude)}m  ${d.location ?? "?"} / ${d.title}`);

if (dryRun) {
  console.log("\n[DRY] no writes. Sample of planned updates:");
  for (const u of updates.slice(0, 8)) console.log(`  ${String(Math.round(u.value)).padStart(4)}m  ${u.location ?? "?"} / ${u.title}`);
  process.exit(0);
}

let done = 0;
for (const u of updates) {
  const { error } = await sb.from("photos").update({ relative_altitude_m: u.value }).eq("id", u.id);
  if (error) throw error;
  done += 1;
  if (done % 50 === 0) console.log(`...${done}/${updates.length}`);
}
console.log(`\nUpdated ${done} photos with relative_altitude_m.`);
