// Apply precise locations to existing photos from imports/geo-existing-analysis.json.
// For each GPS-pinned photo whose place resolves to a real spot, set
// location + title to that place (creating location rows as needed). Generic
// city-only ("Sydney") and no-GPS photos are skipped.
//
// Usage: DRY_RUN=1 node --env-file=.env.local scripts/geo-update-existing.mjs
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const dryRun = process.env.DRY_RUN === "1";

const GENERIC = new Set(["", "sydney", "australia", "new south wales", "nsw"]);
function cleanPlace(precise) {
  let p = String(precise ?? "");
  for (let i = 0; i < 2; i += 1) p = p.replace(/,\s*(Sydney|Australia|New South Wales|NSW)\s*$/i, "").trim();
  return p;
}
function slugify(v) {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const results = JSON.parse(await readFile("imports/geo-existing-analysis.json", "utf8"));
const updates = [];
let skipGeneric = 0;
for (const r of results) {
  if (r.status !== "ok") continue;
  const place = cleanPlace(r.precise);
  if (GENERIC.has(place.toLowerCase())) { skipGeneric += 1; continue; }
  updates.push({ id: r.id, place, from: `${r.current ?? "?"} / "${r.title}"` });
}

const byPlace = {};
for (const u of updates) byPlace[u.place] = (byPlace[u.place] || 0) + 1;
console.log(`Planned updates: ${updates.length} | skipped (generic): ${skipGeneric} | skipped (no GPS / not ok): ${results.length - updates.length - skipGeneric}`);
console.log("\nNew location/title by place:");
for (const [p, n] of Object.entries(byPlace).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${p}`);

if (dryRun) { console.log("\n[DRY] no writes."); } else {
  const { data: existing, error: locErr } = await sb.from("locations").select("id, name, sort_order");
  if (locErr) throw locErr;
  const byName = new Map(existing.map((l) => [l.name, l]));
  let nextSort = existing.reduce((m, l) => Math.max(m, l.sort_order ?? 0), 0);

  for (const name of [...new Set(updates.map((u) => u.place))]) {
    if (byName.has(name)) continue;
    nextSort += 1;
    const { data, error } = await sb
      .from("locations")
      .insert({ name, slug: slugify(name), region: "Australia", sort_order: nextSort, is_visible: true })
      .select("id, name")
      .single();
    if (error) throw error;
    byName.set(name, data);
    console.log(`+ location ${name}`);
  }

  let done = 0;
  for (const u of updates) {
    const loc = byName.get(u.place);
    const { error } = await sb.from("photos").update({ location_id: loc.id, title: u.place }).eq("id", u.id);
    if (error) throw error;
    done += 1;
  }
  console.log(`\nUpdated ${done} photos.`);
}
